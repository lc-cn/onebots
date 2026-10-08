import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { GatewayController } from "../control/gateway-controller.js";
import { NodeGatewayDriver } from "../control/gateway-driver.js";

describe("网关运行期未处理拒绝", () => {
    it("真实子进程继续提供服务，管理服务可读取脱敏故障记录", async () => {
        const workspace = await mkdtemp(join(tmpdir(), "onebots-gateway-rejection-"));
        const configPath = join(workspace, "snapshot.yaml");
        const entrypoint = join(workspace, "fault-entry.mjs");
        await writeFile(configPath, "port: 6727\ngeneral: {}\n");
        await writeFile(
            entrypoint,
            `const originalSend = process.send.bind(process);
process.send = (message, ...args) => {
    const sent = originalSend(message, ...args);
    if (message?.type === "gateway.ready")
        setImmediate(() => {
            for (let index = 0; index < 3; index++)
                Promise.reject(new Error("private-test-secret-" + index));
        });
    return sent;
};
await import(${JSON.stringify(pathToFileURL(resolve("packages/onebots/lib/gateway/entry.js")).href)});
`,
        );
        let controller!: GatewayController;
        const driver = new NodeGatewayDriver({
            controlInstanceId: "rejection-test",
            onExit: (id, error) => void controller.observeExit(id, error),
            prepare: async () => ({
                configPath,
                workspacePath: workspace,
                selection: { adapters: [], protocols: [], applications: [] },
                configVersion: "a".repeat(64),
                dependencyVersion: "dependencies-test",
                entrypoint,
                runtimeRoot: workspace,
            }),
        });
        controller = new GatewayController({
            statePath: join(workspace, ".control", "gateway-state.json"),
            driver,
        });
        try {
            await controller.initialize();
            const start = await controller.start();
            expect(start.status, controller.status().error).toBe("succeeded");
            await vi.waitFor(async () => {
                const log = await readFile(join(workspace, ".control", "gateway.log"), "utf8");
                expect(log).toContain("未处理 Promise 拒绝");
                expect(log).not.toContain("private-test-secret");
            });
            const log = await readFile(join(workspace, ".control", "gateway.log"), "utf8");
            expect(log.match(/网关捕获未处理 Promise 拒绝/g)).toHaveLength(1);
            expect(driver.hasLiveChildren()).toBe(true);
            expect(controller.status()).toMatchObject({
                actual: "running",
                recoveryRequired: false,
            });
            const port = controller.status().instance?.address?.port;
            expect(port).toBeTypeOf("number");
            expect((await fetch(`http://127.0.0.1:${port}/`)).status).toBe(404);
            expect((await controller.stop()).status).toBe("succeeded");
            expect(controller.status().actual).toBe("stopped");
        } finally {
            if (driver.hasLiveChildren()) await controller.stop();
            await rm(workspace, { recursive: true, force: true });
        }
    });
});
