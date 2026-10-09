import { expect, it } from "vitest";
import { fixture } from "../../__tests__/generation-activation.fixture.js";
import { GenerationActivationController } from "../control/generation-activation.js";
import { ControlConfigurationService } from "../control/configuration-service.js";
import { ConfigurationApplication } from "./configuration-application.js";
import { GenerationStore } from "../installation/generation-store.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

it("未 await 的原回执查询仍排空后才允许下一生命周期动作", async () => {
    const base = await fixture();
    let release!: () => void;
    let entered!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    const ready = new Promise<void>(resolve => {
        entered = resolve;
    });
    const activation = new GenerationActivationController({
        ...base.options,
        runtimeConfiguration: {
            context: () => null,
            apply: async () => ({ status: "applied", configVersion: "a".repeat(64) }),
            query: async () => {
                entered();
                await gate;
                return { status: "applied", configVersion: "a".repeat(64) };
            },
        },
    });
    await activation.initialize();
    const recovery = activation.runConfigurationRecoveryTransaction(async port => {
        void port.queryRuntimeConfiguration!({
            id: "old",
            expected: { gatewayInstanceId: "old", configVersion: "b".repeat(64) },
        });
    });
    await ready;
    const start = activation.start();
    try {
        await new Promise(resolve => setImmediate(resolve));
        expect(base.events).toEqual([]);
    } finally {
        release();
    }
    await recovery;
    await start;
    expect(base.events).toEqual(["start:bundled"]);
});

it("配置查询受服务关闭约束，close 等待原回执且关闭后拒绝新查询", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-query-close-"));
    const application = new ConfigurationApplication({
        directory: path.join(root, "operations"),
        source: {
            read: () => ({ document: {}, revision: "a".repeat(64) }),
            replace: () => ({ document: {}, revision: "a".repeat(64) }),
        },
        lifecycle: {
            runConfigurationTransaction: async () => {
                throw new Error("unused");
            },
        },
    });
    let release!: () => void;
    const gate = new Promise<void>(resolve => {
        release = resolve;
    });
    application.hasOperation = () => true;
    application.queryStatus = async () => {
        await gate;
        return {
            id: "old",
            validationId: "receipt",
            status: "succeeded",
            phase: "completed",
            recoveryRequired: false,
        };
    };
    const service = new ControlConfigurationService({
        directory: path.join(root, "configuration"),
        configFile: path.join(root, "config.yaml"),
        runtimeRoot: root,
        generations: new GenerationStore({
            root: path.join(root, "generations"),
            isActive: () => false,
        }),
        application,
        activeGeneration: () => null,
    });
    try {
        const query = service.operation("old");
        let closed = false;
        const close = service.close().then(() => {
            closed = true;
        });
        await new Promise(resolve => setImmediate(resolve));
        expect(closed).toBe(false);
        await expect(service.operation("new")).rejects.toThrow("正在关闭");
        release();
        expect(await query).toMatchObject({ status: "succeeded" });
        await close;
    } finally {
        release();
        await service.close();
        fs.rmSync(root, { recursive: true, force: true });
    }
});
