import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ConfigurationApplication } from "./configuration-application.js";
import type { ConfigurationTransactionPort } from "../control/generation-activation.js";
import { GatewayRequestError } from "../control/gateway-request-client.js";

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(outcome: "applied" | "rolled_back" | "unknown" | "rejected" = "applied") {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-hot-config-"));
    directories.push(directory);
    const before = { "mock.alpha": {} };
    let snapshot = { document: before as Record<string, unknown>, revision: hash(before) };
    const context = { gatewayInstanceId: "gateway-alpha", configVersion: hash("runtime-old") };
    const nextConfigVersion = hash("runtime-new");
    const port: ConfigurationTransactionPort = {
        activeGenerationId: () => null,
        hasLiveChildren: () => true,
        gatewayStatus: () => ({ desired: "running" }),
        suspend: vi.fn(async () => ({ status: "succeeded" })),
        start: vi.fn(async () => ({ status: "succeeded" })),
        runtimeContext: () => context,
        queryRuntimeConfiguration: vi.fn(async () => ({
            status: "recovery_required" as const,
            configVersion: context.configVersion,
        })),
        applyRuntimeConfiguration: vi.fn(async input => {
            const intent = JSON.parse(fs.readFileSync(path.join(directory, "hot-1.json"), "utf8"));
            expect(intent.phase).toBe("applying");
            expect(intent.runtimeBefore).toEqual(context);
            expect(input.nextConfigVersion).toBe(nextConfigVersion);
            if (outcome === "unknown") throw new Error("IPC unavailable");
            if (outcome === "rejected")
                throw new GatewayRequestError("rejected", "前置CAS拒绝，未执行");
            return {
                status: outcome,
                configVersion: outcome === "applied" ? nextConfigVersion : context.configVersion,
            };
        }),
    };
    const source = {
        read: () => structuredClone(snapshot),
        replace: (expected: string, document: Record<string, unknown>) => {
            expect(expected).toBe(snapshot.revision);
            snapshot = { document: structuredClone(document), revision: hash(document) };
            return structuredClone(snapshot);
        },
    };
    const application = new ConfigurationApplication({
        directory,
        source,
        runtime: {
            snapshot: () => ({
                configPath: path.join(directory, "candidate.yaml"),
                configVersion: nextConfigVersion,
            }),
        },
        lifecycle: {
            runConfigurationTransaction: async task => task(port),
            runConfigurationRecoveryTransaction: async task => task(port),
        },
    });
    const request = {
        id: "hot-1",
        validationId: "validation-1",
        base: { generationId: null, configRevision: snapshot.revision },
        document: { ...before, "mock.beta": {} },
    };
    return { application, source, request, port, before, nextConfigVersion, context };
}
it("新增账号只派发热应用，重复请求读取原回执，不启停网关", async () => {
    const test = fixture();
    const result = await test.application.apply(test.request);
    expect(result).toMatchObject({
        status: "succeeded",
        executionMode: "hot",
        impact: { mode: "hot" },
    });
    expect(await test.application.apply(test.request)).toEqual(result);
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
    expect(test.port.start).not.toHaveBeenCalled();
    expect(test.port.suspend).not.toHaveBeenCalled();
});
it("明确回滚才恢复旧文件；未知结果保留候选并封锁写入", async () => {
    const rejected = fixture("rejected");
    expect(await rejected.application.apply(rejected.request)).toMatchObject({
        status: "failed",
        recoveryRequired: true,
    });
    expect(rejected.source.read().document).toEqual(rejected.request.document);
    const rolled = fixture("rolled_back");
    expect(await rolled.application.apply(rolled.request)).toMatchObject({
        status: "failed",
        rolledBack: true,
        recoveryRequired: false,
    });
    expect(rolled.source.read().document).toEqual(rolled.before);
    const unknown = fixture("unknown");
    expect(await unknown.application.apply(unknown.request)).toMatchObject({
        status: "failed",
        recoveryRequired: true,
    });
    expect(unknown.source.read().document).toEqual(unknown.request.document);
    expect(unknown.application.health().recoveryRequired).toBe(true);
});
it("进程级变更必须明确授权，拒绝之前不写文件或派发热操作", async () => {
    const test = fixture();
    await expect(
        test.application.apply({
            ...test.request,
            document: { ...test.before, plugins: { adapters: ["mock"] } },
        }),
    ).rejects.toThrow("明确确认重启");
    expect(test.source.read().document).toEqual(test.before);
    expect(test.port.applyRuntimeConfiguration).not.toHaveBeenCalled();
});

it("在线等效配置只同步运行身份，不启动或停止实例", async () => {
    const test = fixture();
    const result = await test.application.apply({ ...test.request, document: test.before });
    expect(result).toMatchObject({
        status: "succeeded",
        executionMode: "hot",
        impact: { mode: "none" },
    });
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
    expect(test.port.start).not.toHaveBeenCalled();
    expect(test.port.suspend).not.toHaveBeenCalled();
});

it("未知热操作查询迟到applied回执后完成原操作，不重派或启停", async () => {
    const test = fixture("unknown");
    await test.application.apply(test.request);
    vi.mocked(test.port.queryRuntimeConfiguration!).mockResolvedValue({
        status: "applied",
        configVersion: test.nextConfigVersion,
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        status: "succeeded",
        recoveryRequired: false,
    });
    expect(test.application.health().recoveryRequired).toBe(false);
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
    expect(test.port.start).not.toHaveBeenCalled();
    expect(test.port.suspend).not.toHaveBeenCalled();
});
it("未知热操作仅在原回执确认rollback后恢复文件，未完成回执仍封锁", async () => {
    const test = fixture("unknown");
    await test.application.apply(test.request);
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
    });
    expect(test.source.read().document).toEqual(test.request.document);
    vi.mocked(test.port.queryRuntimeConfiguration!).mockResolvedValue({
        status: "rolled_back",
        configVersion: test.context.configVersion,
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        status: "failed",
        rolledBack: true,
        recoveryRequired: false,
    });
    expect(test.application.health().recoveryRequired).toBe(false);
    expect(test.source.read().document).toEqual(test.before);
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
});
it("查询回执不能覆盖外部修改的配置", async () => {
    const test = fixture("unknown");
    await test.application.apply(test.request);
    test.source.replace(test.source.read().revision, { "mock.external": {} });
    vi.mocked(test.port.queryRuntimeConfiguration!).mockResolvedValue({
        status: "rolled_back",
        configVersion: test.context.configVersion,
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
    });
    expect(test.source.read().document).toEqual({ "mock.external": {} });
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
});

it("仅原实例的settled拒绝回执能证明未执行并恢复文件，泛化rejected异常仍封锁", async () => {
    const test = fixture("rejected");
    await test.application.apply(test.request);
    expect(test.application.health().recoveryRequired).toBe(true);
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
    });
    vi.mocked(test.port.queryRuntimeConfiguration!).mockResolvedValue({
        status: "rejected",
        configVersion: hash("wrong-runtime"),
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
    });
    vi.mocked(test.port.queryRuntimeConfiguration!).mockResolvedValue({
        status: "rejected",
        configVersion: test.context.configVersion,
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        status: "failed",
        rolledBack: false,
        recoveryRequired: false,
    });
    expect(test.source.read().document).toEqual(test.before);
    expect(test.application.health().recoveryRequired).toBe(false);
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
    expect(test.port.suspend).not.toHaveBeenCalled();
});

it("原apply直接返回可信未执行拒绝回执时自动恢复，不需要额外查询", async () => {
    const test = fixture();
    vi.mocked(test.port.applyRuntimeConfiguration!).mockResolvedValue({
        status: "rejected",
        configVersion: test.context.configVersion,
    });
    expect(await test.application.apply(test.request)).toMatchObject({
        status: "failed",
        rolledBack: false,
        recoveryRequired: false,
    });
    expect(test.source.read().document).toEqual(test.before);
    expect(test.application.health().recoveryRequired).toBe(false);
    expect(test.port.queryRuntimeConfiguration).not.toHaveBeenCalled();
    expect(test.port.suspend).not.toHaveBeenCalled();
});
it("直接拒绝回执的运行版本不匹配时保留候选并封锁", async () => {
    const test = fixture();
    vi.mocked(test.port.applyRuntimeConfiguration!).mockResolvedValue({
        status: "rejected",
        configVersion: hash("wrong-runtime"),
    });
    expect(await test.application.apply(test.request)).toMatchObject({ recoveryRequired: true });
    expect(test.source.read().document).toEqual(test.request.document);
    expect(test.application.health().recoveryRequired).toBe(true);
});
