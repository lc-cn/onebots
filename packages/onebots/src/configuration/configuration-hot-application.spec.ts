import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import {
    ConfigurationApplication,
    type ConfigurationApplicationOptions,
} from "./configuration-application.js";
import type { ConfigurationTransactionPort } from "../control/generation-activation.js";
import { GatewayRequestError } from "../control/gateway-request-client.js";
import { planRuntimeConfiguration } from "@onebots/core";

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
        runtimeStopped: () => false,
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
    const options: ConfigurationApplicationOptions = {
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
    };
    const application = new ConfigurationApplication(options);
    const request = {
        id: "hot-1",
        validationId: "validation-1",
        base: { generationId: null, configRevision: snapshot.revision },
        document: { ...before, "mock.beta": {} },
    };
    return {
        application,
        source,
        request,
        port,
        before,
        nextConfigVersion,
        context,
        directory,
        options,
    };
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
it("影响规划在进入串行生命周期事务前完成", async () => {
    const test = fixture();
    let release!: () => void;
    const waiting = new Promise<void>(resolve => {
        release = resolve;
    });
    const transaction = vi.spyOn(test.options.lifecycle, "runConfigurationTransaction");
    test.options.planImpact = vi.fn(async (before, after) => {
        await waiting;
        return planRuntimeConfiguration(before, after);
    });
    const applying = test.application.apply(test.request);
    await Promise.resolve();
    expect(transaction).not.toHaveBeenCalled();
    release();
    await applying;
    expect(transaction).toHaveBeenCalledOnce();
});
it("泛化 rejected 异常不能证明未执行，保留候选并封锁", async () => {
    const rejected = fixture("rejected");
    expect(await rejected.application.apply(rejected.request)).toMatchObject({
        status: "failed",
        recoveryRequired: true,
    });
    expect(rejected.source.read().document).toEqual(rejected.request.document);
});
it("明确 rolled_back 回执才恢复旧文件", async () => {
    const rolled = fixture("rolled_back");
    expect(await rolled.application.apply(rolled.request)).toMatchObject({
        status: "failed",
        rolledBack: true,
        recoveryRequired: false,
    });
    expect(rolled.source.read().document).toEqual(rolled.before);
});
it("未知结果保留候选并封锁写入", async () => {
    const unknown = fixture("unknown");
    expect(await unknown.application.apply(unknown.request)).toMatchObject({
        status: "failed",
        recoveryRequired: true,
    });
    expect(unknown.source.read().document).toEqual(unknown.request.document);
    expect(unknown.application.health().recoveryRequired).toBe(true);
});

it("不信任 caller 降级的影响摘要，拒绝前不写文件或操作实例", async () => {
    const test = fixture();
    await expect(
        test.application.apply({
            ...test.request,
            impact: {
                mode: "none",
                accounts: [],
                protocols: [],
                dynamicFields: [],
                restartReasons: [],
            },
        }),
    ).rejects.toThrow("配置已发生变化");
    expect(test.source.read().document).toEqual(test.before);
    expect(test.port.applyRuntimeConfiguration).not.toHaveBeenCalled();
});

it("writing 阶段源文件已经提交但 replace 抛错，查询恢复旧文件且不派发", async () => {
    const test = fixture();
    const snapshot = vi.spyOn(test.options.runtime!, "snapshot");
    const replace = test.source.replace;
    let fail = true;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        const result = replace(expected, document);
        if (fail) {
            fail = false;
            throw new Error("post-commit interruption");
        }
        return result;
    });
    expect(await test.application.apply(test.request)).toMatchObject({
        recoveryRequired: true,
        phase: "writing",
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: false,
        status: "failed",
    });
    expect(test.source.read().document).toEqual(test.before);
    expect(snapshot).not.toHaveBeenCalled();
    expect(test.port.applyRuntimeConfiguration).not.toHaveBeenCalled();
    expect(snapshot).not.toHaveBeenCalled();
});

it("无法确认原运行实例时，即使进程表为空也不恢复候选文件", async () => {
    const test = fixture();
    const replace = test.source.replace;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        replace(expected, document);
        throw new Error("post-commit interruption");
    });
    await test.application.apply(test.request);
    test.port.hasLiveChildren = () => false;
    test.port.runtimeContext = () => undefined;
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
        phase: "writing",
    });
    expect(test.source.read().document).toEqual(test.request.document);
});

it("restoring 已提交但 replace 抛错，重查询识别旧文件不重派", async () => {
    const test = fixture("rolled_back");
    const replace = test.source.replace;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        const result = replace(expected, document);
        if (document["mock.beta"] === undefined) throw new Error("post-restore interruption");
        return result;
    });
    expect(await test.application.apply(test.request)).toMatchObject({
        recoveryRequired: true,
        phase: "restoring",
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: false,
        status: "failed",
        rolledBack: true,
    });
    expect(test.source.read().document).toEqual(test.before);
    expect(test.port.applyRuntimeConfiguration).toHaveBeenCalledTimes(1);
});

it("stored 源文件提交后抛错，查询核对候选后收敛且不启动网关", async () => {
    const test = fixture();
    test.port.gatewayStatus = () => ({ desired: "stopped" });
    test.port.hasLiveChildren = () => false;
    test.port.runtimeStopped = () => true;
    const replace = test.source.replace;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        replace(expected, document);
        throw new Error("post-store interruption");
    });
    expect(await test.application.apply(test.request)).toMatchObject({
        executionMode: "stored",
        recoveryRequired: true,
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: false,
        status: "succeeded",
    });
    expect(test.port.start).not.toHaveBeenCalled();
    expect(test.port.applyRuntimeConfiguration).not.toHaveBeenCalled();
});

it("运行中等效配置使用 stored 模式时允许按磁盘事实收敛", async () => {
    const test = fixture();
    test.port.applyRuntimeConfiguration = undefined;
    const replace = test.source.replace;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        replace(expected, document);
        throw new Error("post-store interruption");
    });
    const request = { ...test.request, document: test.before };
    expect(await test.application.apply(request)).toMatchObject({
        executionMode: "stored",
        recoveryRequired: true,
    });
    expect(await test.application.queryStatus(request.id)).toMatchObject({
        recoveryRequired: false,
        status: "succeeded",
    });
});

it("新实例达到候选版本不能证明旧实例原动作成功", async () => {
    const test = fixture("unknown");
    await test.application.apply(test.request);
    test.port.runtimeContext = () => ({
        gatewayInstanceId: "replacement",
        configVersion: test.nextConfigVersion,
    });
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
    });
    expect(test.port.queryRuntimeConfiguration).not.toHaveBeenCalled();
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

it("源写确认后快照失败，冷恢复回旧文档解除封锁且不派发", async () => {
    const test = fixture();
    vi.spyOn(test.options.runtime!, "snapshot").mockImplementation(() => {
        throw new Error("snapshot failed");
    });
    expect(await test.application.apply(test.request)).toMatchObject({
        recoveryRequired: true,
        phase: "writing",
    });
    expect(test.source.read().document).toEqual(test.request.document);
    const restarted = new ConfigurationApplication(test.options);
    expect(await restarted.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: false,
        status: "failed",
    });
    expect(test.port.applyRuntimeConfiguration).not.toHaveBeenCalled();
    expect(test.source.read().document).toEqual(test.before);
});

it("驱动 children 为空但无持久静止或原实例证据，不恢复候选或解除门禁", async () => {
    const test = fixture();
    const replace = test.source.replace;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        replace(expected, document);
        throw new Error("post-commit interruption");
    });
    await test.application.apply(test.request);
    test.port.hasLiveChildren = () => false;
    test.port.runtimeContext = () => undefined;
    expect(await test.application.queryStatus(test.request.id)).toMatchObject({
        recoveryRequired: true,
    });
    expect(test.source.read().document).toEqual(test.request.document);
    expect(test.port.applyRuntimeConfiguration).not.toHaveBeenCalled();
});

it("在线 none 的 stored 保存中断可核对磁盘收敛，不要求停止账号", async () => {
    const test = fixture();
    test.options.runtime = undefined;
    const replace = test.source.replace;
    vi.spyOn(test.source, "replace").mockImplementation((expected, document) => {
        replace(expected, document);
        throw new Error("post-commit interruption");
    });
    const request = { ...test.request, document: test.before };
    expect(await test.application.apply(request)).toMatchObject({
        recoveryRequired: true,
        executionMode: "stored",
        impact: { mode: "none" },
    });
    expect(await test.application.queryStatus(request.id)).toMatchObject({
        recoveryRequired: false,
        status: "succeeded",
    });
    expect(test.port.start).not.toHaveBeenCalled();
    expect(test.port.suspend).not.toHaveBeenCalled();
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
