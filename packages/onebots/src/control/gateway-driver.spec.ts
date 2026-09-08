import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GatewayController, GatewayStartReapedError } from "./gateway-controller.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { NodeGatewayDriver } from "./gateway-driver.js";

const folders: string[] = [];
afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(
        folders.splice(0).map(folder => rm(folder, { recursive: true, force: true })),
    );
});

async function fixture(mode = "ready") {
    const folder = await mkdtemp(join(tmpdir(), "onebots-driver-"));
    folders.push(folder);
    const entrypoint = join(folder, "child.mjs");
    await writeFile(
        entrypoint,
        `
import { writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
process.on('disconnect', () => process.exit(0));
if (${JSON.stringify(mode)} === 'ignore-stop') process.on('SIGTERM', () => {});
process.on('message', message => {
    if (message.type === 'gateway.stop') {
        if (${JSON.stringify(mode)} !== 'ignore-stop') process.exit(0);
        return;
    }
    const mode = ${JSON.stringify(mode)};
    writeFileSync(message.workspacePath + '/environment.json', JSON.stringify(process.env));
    writeFileSync(message.workspacePath + '/pid.txt', String(process.pid));
    console.log('fixture-started');
    if (mode === 'timeout') return;
    if (mode === 'exit') process.exit(3);
    const ready = {...message, type:'gateway.ready', address:{host:'127.0.0.1', port:12345}};
    if (mode === 'helper') { const helper=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'}); writeFileSync(message.workspacePath+'/helper.txt',String(helper.pid)); ready.gatewayInstanceId='wrong'; }
    if (mode === 'identity') ready.gatewayInstanceId = 'wrong-instance';
    if (mode === 'version') ready.dependencyVersion = 'wrong-version';
    if (mode === 'address') ready.address.host = '0.0.0.0';
    if (mode === 'port') ready.address.port = 65536;
    if (mode === 'unknown') ready.type = 'unknown';
    process.send(ready);
});
`,
    );
    const onExit = vi.fn();
    const driver = new NodeGatewayDriver({
        controlInstanceId: "control-1",
        onExit,
        startupTimeoutMs: 700,
        stopTimeoutMs: 50,
        prepare: async () => ({
            configPath: join(folder, "config.yaml"),
            workspacePath: folder,
            selection: { adapters: [], protocols: [], applications: [] },
            configVersion: "config-1",
            dependencyVersion: "dependency-1",
            entrypoint,
            runtimeRoot: folder,
        }),
    });
    return { driver, folder, onExit };
}

describe("NodeGatewayDriver real fork lifecycle", () => {
    it("真实损坏YAML在prepare阶段失败，保持running意图但不留下恢复门禁", async () => {
        const folder = await mkdtemp(join(tmpdir(), "onebots-prepare-failed-"));
        folders.push(folder);
        const filename = join(folder, "config.yaml");
        await writeFile(filename, "invalid: [private-secret");
        const source = new ConfigurationFile(filename);
        const driver = new NodeGatewayDriver({
            controlInstanceId: "test",
            onExit: () => {},
            prepare: async () => {
                source.read();
                throw new Error("unreachable");
            },
        });
        const controller = new GatewayController({ statePath: join(folder, "state.json"), driver });
        await controller.initialize();
        expect((await controller.start()).status).toBe("failed");
        expect(controller.status()).toMatchObject({
            actual: "failed",
            desired: "running",
            recoveryRequired: false,
        });
        expect(driver.hasLiveChildren()).toBe(false);
        expect(JSON.stringify(controller.status())).not.toContain("private-secret");
    });
    it("握手失败回收真实helper后才返回可信失败", async () => {
        const { driver, folder } = await fixture("helper");
        await expect(driver.start()).rejects.toBeInstanceOf(GatewayStartReapedError);
        const pid = Number(await readFile(join(folder, "helper.txt"), "utf8"));
        expect(() => process.kill(pid, 0)).toThrow();
        expect(driver.hasLiveChildren()).toBe(false);
    });
    it("owned握手失败但进程组清理失败，绝不能声明已回收", async () => {
        const { driver, folder } = await fixture("identity");
        const originalKill = process.kill.bind(process);
        const mocked = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
            if (pid < 0 && signal !== 0)
                throw Object.assign(new Error("denied"), { code: "EPERM" });
            return originalKill(pid, signal);
        });
        try {
            let failure: unknown;
            try {
                await driver.start();
            } catch (error) {
                failure = error;
            }
            expect(failure).toBeInstanceOf(Error);
            expect(failure).not.toBeInstanceOf(GatewayStartReapedError);
            expect(driver.hasLiveChildren()).toBe(true);
        } finally {
            mocked.mockRestore();
            const pid = Number(await readFile(join(folder, "pid.txt"), "utf8"));
            originalKill(-pid, "SIGKILL");
            await vi.waitFor(() => expect(driver.hasLiveChildren()).toBe(false));
        }
    });
    it("returns the validated address, keeps credentials out of env, and reaps stop", async () => {
        vi.stubEnv("NODE_AUTH_TOKEN", "private-test-download-secret");
        vi.stubEnv("ONEBOTS_CONTROL_TOKEN", "private-test-control-secret");
        vi.stubEnv("NODE_OPTIONS", "--invalid-parent-option");
        const { driver, folder, onExit } = await fixture();
        const instance = await driver.start();
        try {
            expect(instance).toMatchObject({ address: { host: "127.0.0.1", port: 12345 } });
            expect(instance.pid).toBeGreaterThan(0);
            expect(driver.hasLiveChildren()).toBe(true);
            const env = JSON.parse(await readFile(join(folder, "environment.json"), "utf8"));
            expect(env.NODE_AUTH_TOKEN).toBeUndefined();
            expect(env.ONEBOTS_CONTROL_TOKEN).toBeUndefined();
            expect(env.NODE_OPTIONS).toBeUndefined();
            expect((await stat(join(folder, ".control/gateway.log"))).mode & 0o777).toBe(0o600);
            expect(await readFile(join(folder, ".control/gateway.log"), "utf8")).toContain(
                "fixture-started",
            );
            await expect(driver.start()).rejects.toThrow("重复启动");
        } finally {
            await driver.stop(instance);
        }
        expect(driver.hasLiveChildren()).toBe(false);
        expect(onExit).toHaveBeenCalledWith(instance.id, undefined);
    });

    it.each(["identity", "version", "address", "port", "unknown"])(
        "rejects %s handshakes and cleans the child",
        async mode => {
            const { driver } = await fixture(mode);
            await expect(driver.start()).rejects.toBeInstanceOf(GatewayStartReapedError);
            expect(driver.hasLiveChildren()).toBe(false);
        },
    );

    it("reaps a child after startup timeout", async () => {
        const { driver } = await fixture("timeout");
        await expect(driver.start()).rejects.toThrow("超时");
        expect(driver.hasLiveChildren()).toBe(false);
    });

    it("reports exit before readiness as failure", async () => {
        const { driver } = await fixture("exit");
        await expect(driver.start()).rejects.toThrow("握手前退出");
        expect(driver.hasLiveChildren()).toBe(false);
    });

    it("forces only the currently held child after stop timeout", async () => {
        const { driver, onExit } = await fixture("ignore-stop");
        const first = await driver.start();
        await driver.stop(first);
        expect(driver.hasLiveChildren()).toBe(false);
        const second = await driver.start();
        try {
            expect(second.id).not.toBe(first.id);
            await expect(driver.stop(first)).rejects.toThrow("未持有");
            expect(driver.hasLiveChildren()).toBe(true);
        } finally {
            await driver.stop(second);
        }
        await vi.waitFor(() =>
            expect(onExit.mock.calls.map(call => call[0])).toEqual([first.id, second.id]),
        );
    });
});
