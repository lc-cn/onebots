import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
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
process.on('disconnect', () => process.exit(0));
if (${JSON.stringify(mode)} === 'ignore-stop') process.on('SIGTERM', () => {});
process.on('message', message => {
    if (message.type === 'gateway.stop') {
        if (${JSON.stringify(mode)} !== 'ignore-stop') process.exit(0);
        return;
    }
    const mode = ${JSON.stringify(mode)};
    writeFileSync(message.workspacePath + '/environment.json', JSON.stringify(process.env));
    console.log('fixture-started');
    if (mode === 'timeout') return;
    if (mode === 'exit') process.exit(3);
    const ready = {...message, type:'gateway.ready', address:{host:'127.0.0.1', port:12345}};
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
            await expect(driver.start()).rejects.toThrow("握手无效");
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
        expect(onExit.mock.calls.map(call => call[0])).toEqual([first.id, second.id]);
    });
});
