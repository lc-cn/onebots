import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GatewayController } from "./gateway-controller.js";
import { GenerationActivationController } from "./generation-activation.js";
import type { VerifiedGeneration } from "../installation/generation-store.js";

const directories: string[] = [];
afterEach(async () => {
    await Promise.all(
        directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
    );
});

function verified(id: string): VerifiedGeneration {
    return {
        id,
        directory: `/generations/${id}`,
        operationId: "install-1",
        planDigest: "a".repeat(64),
        receipt: {
            schemaVersion: 1,
            phase: "verified",
            id,
            storeId: "store-1",
            operationId: "install-1",
            verifiedAt: "2026-09-08T00:00:00.000Z",
            planDigest: "a".repeat(64),
            hostVersion: "1.2.12",
            coreVersion: "1.0.4",
            platform: process.platform,
            arch: process.arch,
            nodeAbi: process.versions.modules,
            lockDigest: "b".repeat(64),
            schemasDigest: "c".repeat(64),
            hostManifestDigest: "d".repeat(64),
            coreManifestDigest: "e".repeat(64),
            checks: {
                packageIdentity: true,
                peerDependencies: true,
                singleHost: true,
                loadRegistration: true,
                schemas: true,
            },
        },
    };
}

async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "onebots-activation-"));
    directories.push(directory);
    const events: string[] = [];
    const state = {
        live: false,
        failTarget: false,
        leakTarget: false,
        failRollback: false,
        stopBarrier: undefined as Promise<void> | undefined,
        afterStart: undefined as (() => Promise<void>) | undefined,
    };
    const statePath = join(directory, "activation.json");
    let activation: GenerationActivationController;
    let sequence = 0;
    const gateway = new GatewayController({
        statePath: join(directory, "gateway.json"),
        driver: {
            async start() {
                const generation = activation.activeGeneration()?.id ?? "bundled";
                events.push(`start:${generation}`);
                const persisted = JSON.parse(await readFile(statePath, "utf8"));
                expect(persisted.active?.id ?? "bundled").toBe(generation);
                if (generation === "target" && state.failTarget) {
                    state.live = state.leakTarget;
                    throw new Error("target failed");
                }
                if (generation === "bundled" && state.failRollback && events.length > 1)
                    throw new Error("rollback failed");
                expect(state.live).toBe(false);
                state.live = true;
                await state.afterStart?.();
                return { id: String(++sequence) };
            },
            async stop() {
                events.push("stop");
                if (state.stopBarrier) await state.stopBarrier;
                state.live = false;
            },
        },
    });
    const options = {
        statePath,
        gateway,
        readVerified: (id: string) => {
            if (!["target", "other"].includes(id)) throw new Error("not verified");
            return verified(id);
        },
        hasLiveChildren: () => state.live,
    };
    activation = new GenerationActivationController(options);
    await activation.initialize();
    return { activation, gateway, state, statePath, options, events };
}

describe("generation activation serialized lifecycle", () => {
    it("serializes two clients CAS and refresh retries never restart the applied candidate", async () => {
        const { activation, events, options } = await fixture();
        await activation.start();
        const first = activation.activate("target", null);
        const second = activation.activate("other", null);
        await expect(first).resolves.toMatchObject({ status: "succeeded" });
        await expect(second).rejects.toThrow("运行版本已变化");
        const before = [...events];
        const result = await activation.activate("target", null);
        expect(result).toEqual(await first);
        expect(events).toEqual(before);
        const reopened = new GenerationActivationController(options);
        await reopened.initialize();
        expect(await reopened.activate("target", null)).toEqual(result);
        expect(events).toEqual(before);
    });
    it("does not dispatch effects when the initial activation intent cannot be saved", async () => {
        const { activation, statePath, events } = await fixture();
        const before = activation.status();
        await rename(statePath, `${statePath}.saved`);
        await mkdir(statePath);
        await expect(activation.activate("target")).rejects.toThrow();
        expect(activation.status()).toEqual(before);
        expect(events).toEqual([]);
    });

    it("fails closed if the ready target cannot be committed durably", async () => {
        const { activation, statePath, events, state } = await fixture();
        await activation.start();
        state.afterStart = async () => {
            await rename(statePath, `${statePath}.saved`);
            await mkdir(statePath);
        };
        await expect(activation.activate("target")).rejects.toThrow();
        expect(activation.status()).toMatchObject({
            recoveryRequired: true,
            active: { id: "target" },
        });
        expect(activation.status().operations.at(-1)).toMatchObject({ status: "failed" });
        await expect(activation.restart()).rejects.toThrow("需要对账");
        await expect(activation.reconcileStopped(() => true)).rejects.toThrow("版本切换需要对账");
        expect(events).toEqual(["start:bundled", "stop", "start:target"]);
    });

    it("switches the pointer while preserving stopped user intent without opening accounts", async () => {
        const { activation, events, statePath } = await fixture();
        expect(await activation.activate("target")).toMatchObject({ status: "succeeded" });
        expect(activation.activeGeneration()?.id).toBe("target");
        expect(activation.status().gateway).toMatchObject({
            desired: "stopped",
            actual: "stopped",
        });
        expect(events).toEqual([]);
        expect(JSON.parse(await readFile(statePath, "utf8")).operations.at(-1).status).toBe(
            "succeeded",
        );
    });

    it("stops the old runtime before switching and commits only after the new instance is ready", async () => {
        const { activation, events } = await fixture();
        await activation.start();
        expect(await activation.activate("target")).toMatchObject({
            status: "succeeded",
            desiredBefore: "running",
        });
        expect(events).toEqual(["start:bundled", "stop", "start:target"]);
        expect(activation.status().gateway).toMatchObject({
            desired: "running",
            actual: "running",
        });
        await activation.activate("target");
        expect(events).toHaveLength(3);
    });

    it("serializes external stop/start through the entire activation, not merely each gateway call", async () => {
        const { activation, events, state } = await fixture();
        await activation.start();
        let release!: () => void;
        state.stopBarrier = new Promise(resolve => {
            release = resolve;
        });
        const switching = activation.activate("target");
        const stopping = activation.stop();
        const starting = activation.start();
        while (!events.includes("stop")) await new Promise(resolve => setImmediate(resolve));
        expect(events).toEqual(["start:bundled", "stop"]);
        release();
        await Promise.all([switching, stopping, starting]);
        expect(events).toEqual(["start:bundled", "stop", "start:target", "stop", "start:target"]);
    });

    it("restores the prior pointer and runtime after a confirmed clean target failure", async () => {
        const { activation, events, state } = await fixture();
        await activation.start();
        state.failTarget = true;
        expect(await activation.activate("target")).toMatchObject({
            status: "failed",
            rolledBack: true,
        });
        expect(activation.activeGeneration()).toBeNull();
        expect(activation.status()).toMatchObject({
            recoveryRequired: false,
            gateway: { desired: "running", actual: "running" },
        });
        expect(events).toEqual(["start:bundled", "stop", "start:target", "start:bundled"]);
    });

    it("never launches a rollback if the failed target may still be alive", async () => {
        const { activation, events, state } = await fixture();
        await activation.start();
        state.failTarget = state.leakTarget = true;
        expect(await activation.activate("target")).toMatchObject({ status: "failed" });
        expect(events).toEqual(["start:bundled", "stop", "start:target"]);
        expect(activation.status().recoveryRequired).toBe(true);
        await expect(activation.start()).rejects.toThrow("需要对账");
        await expect(activation.activate("other")).rejects.toThrow("需要对账");
    });

    it("does not call failed rollback success or retry it indefinitely", async () => {
        const { activation, events, state } = await fixture();
        await activation.start();
        state.failTarget = state.failRollback = true;
        const result = await activation.activate("target");
        expect(result).toMatchObject({ status: "failed" });
        expect(result.rolledBack).not.toBe(true);
        expect(activation.status().recoveryRequired).toBe(true);
        expect(events).toEqual(["start:bundled", "stop", "start:target", "start:bundled"]);
    });

    it("rejects an unverified generation without stopping the running gateway", async () => {
        const { activation, events } = await fixture();
        await activation.start();
        await expect(activation.activate("unverified")).rejects.toThrow("not verified");
        expect(events).toEqual(["start:bundled"]);
    });

    it("marks a cold interrupted switch unknown without trusting absence of locally owned children", async () => {
        const { activation, statePath, options, events } = await fixture();
        await activation.activate("target");
        const disk = JSON.parse(await readFile(statePath, "utf8"));
        disk.operations.at(-1).status = "running";
        disk.operations.at(-1).phase = "starting";
        await writeFile(statePath, JSON.stringify(disk));
        const restored = new GenerationActivationController(options);
        await restored.initialize();
        expect(restored.status()).toMatchObject({ recoveryRequired: true });
        expect(restored.status().operations.at(-1)).toMatchObject({ status: "failed" });
        await expect(restored.start()).rejects.toThrow("需要对账");
        expect(events).toEqual([]);
    });

    it("does not let activation reconcile an old gateway merely because this driver owns no children", async () => {
        const { activation, statePath, options, events, state } = await fixture();
        await activation.start();
        state.live = false; // A new manager cannot see the old manager's children.
        const gateway = new GatewayController({
            statePath: join(dirname(statePath), "gateway.json"),
            driver: {
                start: async () => {
                    throw new Error("must not spawn");
                },
                stop: async () => {
                    throw new Error("must not kill stale PID");
                },
            },
        });
        const restored = new GenerationActivationController({ ...options, gateway });
        await restored.initialize();
        await expect(restored.activate("target")).rejects.toThrow("网关实例需要对账");
        expect(events).toEqual(["start:bundled"]);
        expect(restored.status().operations).toEqual([]);
        await expect(restored.reconcileStopped(() => false)).rejects.toThrow("缺少");
        await restored.reconcileStopped(snapshot => snapshot.instance?.id === "1");
        expect(restored.status().gateway.recoveryRequired).toBe(false);
    });
});
