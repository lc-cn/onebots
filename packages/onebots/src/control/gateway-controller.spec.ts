import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayController, type GatewayDriver } from "./gateway-controller.js";

const folders: string[] = [];
afterEach(async () => {
    await Promise.all(
        folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })),
    );
});

async function fixture(driver?: GatewayDriver) {
    const folder = await mkdtemp(join(tmpdir(), "onebots-lifecycle-"));
    folders.push(folder);
    const statePath = join(folder, "state.json");
    const defaultDriver = {
        start: vi.fn(async () => ({ id: "instance-1" })),
        stop: vi.fn(async () => undefined),
    };
    const controller = new GatewayController({ statePath, driver: driver ?? defaultDriver });
    await controller.initialize();
    return { controller, statePath, driver: defaultDriver };
}

describe("GatewayController", () => {
    it("restores committed memory when intent cannot be persisted and dispatches no effect", async () => {
        const { controller, driver, statePath } = await fixture();
        const before = controller.status();
        await rename(statePath, `${statePath}.saved`);
        await mkdir(statePath);
        await expect(controller.start()).rejects.toThrow("写入失败");
        expect(controller.status()).toEqual(before);
        expect(driver.start).not.toHaveBeenCalled();
        await rm(statePath, { recursive: true });
        await rename(`${statePath}.saved`, statePath);
        expect(await controller.start()).toMatchObject({ status: "succeeded" });
    });

    it("blocks new starts after an effect succeeds but its final record cannot be persisted", async () => {
        const { controller, driver, statePath } = await fixture();
        driver.start.mockImplementationOnce(async () => {
            await rename(statePath, `${statePath}.saved`);
            await mkdir(statePath);
            return { id: "live-after-write-failure" };
        });
        await expect(controller.start()).rejects.toThrow("操作结果未知");
        expect(controller.status()).toMatchObject({
            desired: "running",
            actual: "failed",
            recoveryRequired: true,
            instance: { id: "live-after-write-failure" },
        });
        await rm(statePath, { recursive: true });
        await rename(`${statePath}.saved`, statePath);
        await expect(controller.start()).rejects.toThrow("结果未知");
        await expect(controller.restart()).rejects.toThrow("结果未知");
        expect(driver.start).toHaveBeenCalledTimes(1);
        expect(await controller.stop()).toMatchObject({ status: "succeeded" });
        expect(await controller.start()).toMatchObject({ status: "succeeded" });
    });

    it("requires reconciliation after confirmed exit cannot be persisted and never restarts", async () => {
        const { controller, driver, statePath } = await fixture();
        await controller.start();
        driver.stop.mockImplementationOnce(async () => {
            await rename(statePath, `${statePath}.saved`);
            await mkdir(statePath);
        });
        await expect(controller.restart()).rejects.toThrow("操作结果未知");
        expect(driver.start).toHaveBeenCalledTimes(1);
        expect(controller.status().instance).toBeUndefined();
        await rm(statePath, { recursive: true });
        await rename(`${statePath}.saved`, statePath);
        await expect(controller.restart()).rejects.toThrow("结果未知");
        // The driver has confirmed exit; the host may now reconcile that exact outcome.
        expect(await controller.reconcileStopped()).toMatchObject({ status: "succeeded" });
        expect(await controller.start()).toMatchObject({ status: "succeeded" });
    });

    it("allows cleanup to be retried after shutdown fails without permitting a new start", async () => {
        const { controller, driver } = await fixture();
        await controller.start();
        driver.stop.mockRejectedValueOnce(new Error("shutdown timeout"));
        expect(await controller.shutdown()).toMatchObject({ status: "failed" });
        expect(controller.status().desired).toBe("running");
        await expect(controller.start()).rejects.toThrow("正在关闭");
        expect(await controller.stop()).toMatchObject({ status: "succeeded" });
        expect(driver.stop).toHaveBeenCalledTimes(2);
        expect(await controller.shutdown()).toMatchObject({ status: "succeeded" });
    });

    it("serializes repeated starts and stops without double spawning", async () => {
        const { controller, driver } = await fixture();
        const operations = await Promise.all([
            controller.start(),
            controller.start(),
            controller.stop(),
            controller.stop(),
        ]);
        expect(operations.every(operation => operation.status === "succeeded")).toBe(true);
        expect(driver.start).toHaveBeenCalledTimes(1);
        expect(driver.stop).toHaveBeenCalledTimes(1);
        expect(controller.status()).toMatchObject({ desired: "stopped", actual: "stopped" });
    });

    it("persists intent before effects and returns final durable results", async () => {
        let statePath = "";
        const driver: GatewayDriver = {
            async start() {
                const persisted = JSON.parse(await readFile(statePath, "utf8"));
                expect(persisted).toMatchObject({ desired: "running", actual: "starting" });
                expect(persisted.operations.at(-1).status).toBe("running");
                return { id: "ready", address: { host: "127.0.0.1", port: 12345 } };
            },
            async stop() {
                expect(JSON.parse(await readFile(statePath, "utf8")).desired).toBe("stopped");
            },
        };
        const fixtureResult = await fixture(driver);
        statePath = fixtureResult.statePath;
        const operation = await fixtureResult.controller.start();
        const disk = JSON.parse(await readFile(statePath, "utf8"));
        expect(disk.operations.at(-1)).toEqual(operation);
        expect(disk.instance.address.port).toBe(12345);
        await fixtureResult.controller.stop();
    });

    it("does not start again when a prior stop fails", async () => {
        const { controller, driver } = await fixture();
        await controller.start();
        driver.stop.mockRejectedValueOnce(new Error("stop timeout"));
        expect(await controller.restart()).toMatchObject({
            status: "failed",
            error: "stop timeout",
        });
        expect(await controller.start()).toMatchObject({ status: "failed" });
        expect(driver.start).toHaveBeenCalledTimes(1);
        expect(controller.status().instance?.id).toBe("instance-1");
        await controller.stop();
        expect(controller.status().actual).toBe("stopped");
    });

    it("retains desired running across shutdown and initializes stopped without spawning", async () => {
        const { controller, driver, statePath } = await fixture();
        await controller.start();
        await controller.shutdown();
        expect(controller.status()).toMatchObject({ desired: "running", actual: "stopped" });
        const restored = new GatewayController({ statePath, driver });
        expect(await restored.initialize()).toMatchObject({
            desired: "running",
            actual: "stopped",
            recoveryRequired: false,
        });
        expect(driver.start).toHaveBeenCalledTimes(1);
        await expect(controller.start()).rejects.toThrow("正在关闭");
    });

    it("refuses stale instance recovery until the host proves the old process is gone", async () => {
        const { controller, driver, statePath } = await fixture();
        await controller.start();
        const restored = new GatewayController({ statePath, driver });
        expect(await restored.initialize()).toMatchObject({
            actual: "failed",
            recoveryRequired: true,
        });
        expect(await restored.start()).toMatchObject({ status: "failed" });
        expect(await restored.stop()).toMatchObject({ status: "failed" });
        expect(driver.start).toHaveBeenCalledTimes(1);
        expect(driver.stop).not.toHaveBeenCalled();
        await restored.reconcileStopped();
        expect(await restored.start()).toMatchObject({ status: "succeeded" });
    });

    it("records an unknown spawn failure and never blindly retries", async () => {
        const { controller, driver } = await fixture();
        driver.start.mockRejectedValueOnce(new Error("handshake timeout"));
        expect(await controller.start()).toMatchObject({
            status: "failed",
            error: "handshake timeout",
        });
        expect(controller.status()).toMatchObject({ actual: "failed", recoveryRequired: true });
        await controller.start();
        expect(driver.start).toHaveBeenCalledTimes(1);
    });

    it("ignores exits from old instances and reports actual current exits", async () => {
        let sequence = 0;
        const { controller } = await fixture({
            start: async () => ({ id: String(++sequence) }),
            stop: async () => undefined,
        });
        await controller.start();
        await controller.restart();
        await controller.observeExit("1", "late exit");
        expect(controller.status()).toMatchObject({ actual: "running", instance: { id: "2" } });
        await controller.observeExit("2", "crash");
        expect(controller.status()).toMatchObject({
            desired: "running",
            actual: "failed",
            error: "crash",
            recoveryRequired: false,
        });
        expect(controller.status().instance).toBeUndefined();
    });

    it("fails closed on corrupt persistence instead of silently starting a new workspace", async () => {
        const { statePath, driver } = await fixture();
        await writeFile(statePath, '{"schemaVersion":2}');
        const controller = new GatewayController({ statePath, driver });
        await expect(controller.initialize()).rejects.toThrow("损坏");
        await expect(controller.start()).rejects.toThrow("尚未初始化");
        expect(driver.start).not.toHaveBeenCalled();
    });

    it("does not treat missing PID as proof that an interrupted start left no child", async () => {
        const { controller, statePath, driver } = await fixture();
        await writeFile(
            statePath,
            JSON.stringify({
                ...controller.status(),
                desired: "running",
                actual: "starting",
                recoveryRequired: true,
                operations: [
                    {
                        id: "interrupted",
                        action: "start",
                        status: "running",
                        startedAt: new Date().toISOString(),
                    },
                ],
            }),
        );
        const recovered = new GatewayController({ statePath, driver });
        expect(await recovered.initialize()).toMatchObject({
            actual: "failed",
            recoveryRequired: true,
        });
        expect(await recovered.start()).toMatchObject({ status: "failed" });
        expect(driver.start).not.toHaveBeenCalled();
        expect(driver.stop).not.toHaveBeenCalled();
    });
});
