import { expect, it, vi } from "vitest";
import { runManagerProgramUpdate } from "./manager-program-update.js";
import { ManagerUpgradeCandidateRejectedError } from "../manager-service-upgrade-preparation.js";
import { ManagerServiceUpgradeRejectedError } from "../manager-service-upgrade.js";

const digest = "a".repeat(64);
const archiveSha256 = "b".repeat(64);
function fixture() {
    const hostArchive = Buffer.from("host archive");
    const coreArchive = Buffer.from("core archive");
    const output = vi.fn();
    const resolve = vi.fn(async () => ({
        host: {
            name: "onebots",
            version: "1.2.13",
            spec: "file:/verified/onebots.tgz",
            sha256: archiveSha256,
        },
        core: {
            name: "@onebots/core",
            version: "1.2.13",
            spec: "file:/verified/core.tgz",
            sha256: "d".repeat(64),
        },
        extensionVersions: {},
        archiveSha256,
        archives: {
            host: { bytes: hostArchive, sha256: archiveSha256 },
            core: { bytes: coreArchive, sha256: "d".repeat(64) },
        },
    }));
    const inspect = vi.fn(() => ({ version: "1.2.12", digest }));
    const prepare = vi.fn(async () => ({
        operationId: "operation-1",
        candidateDirectory: "/private/candidate",
        candidateDigest: "c".repeat(64),
        targetVersion: "1.2.13",
    }));
    const resume = vi.fn(async () => ({
        operationId: "operation-1",
        candidateDirectory: "/private/candidate",
        candidateDigest: "c".repeat(64),
        targetVersion: "1.2.13",
        archiveSha256,
        coreArchiveSha256: "d".repeat(64),
    }));
    const upgrade = vi.fn(async () => ({ status: "succeeded" }));
    return {
        output,
        resolve,
        inspect,
        prepare,
        resume,
        upgrade,
        operationExists: vi.fn(() => false),
        randomId: () => "operation-1",
        host: {
            platform: "linux" as const,
            homedir: "/home/test",
            uid: 1000,
            env: {},
            exec: vi.fn(),
            spawn: vi.fn(),
        },
    };
}

it("check只输出当前版本、精确目标和发布归档摘要", async () => {
    const f = fixture();
    expect(
        await runManagerProgramUpdate(
            { check: true, yes: false, system: false, version: "1.2.13" },
            { ...f, interactive: false },
        ),
    ).toBe(2);
    expect(f.resolve).toHaveBeenCalledWith("1.2.13");
    expect(JSON.parse(f.output.mock.calls[0][0])).toEqual({
        scope: "manager",
        serviceScope: "user",
        state: "updates_available",
        currentVersion: "1.2.12",
        targetVersion: "1.2.13",
        archiveSha256,
        coreArchiveSha256: "d".repeat(64),
    });
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.upgrade).not.toHaveBeenCalled();
});

it("非交互必须显式确认，确认后以同一操作ID准备候选并执行CAS切换", async () => {
    const f = fixture();
    await expect(
        runManagerProgramUpdate(
            { check: false, yes: false, system: false },
            { ...f, interactive: false },
        ),
    ).rejects.toThrow("--yes");
    expect(f.prepare).not.toHaveBeenCalled();
    expect(
        await runManagerProgramUpdate(
            { check: false, yes: true, system: false, version: "1.2.13" },
            { ...f, interactive: false },
        ),
    ).toBe(0);
    expect(f.prepare).toHaveBeenCalledWith(
        {
            id: "operation-1",
            scope: "user",
            expectedPreviousDigest: digest,
            archiveSha256,
            artifacts: {
                host: {
                    name: "onebots",
                    version: "1.2.13",
                    spec: "file:/verified/onebots.tgz",
                },
                core: {
                    name: "@onebots/core",
                    version: "1.2.13",
                    spec: "file:/verified/core.tgz",
                },
            },
            archives: expect.objectContaining({
                host: expect.any(Object),
                core: expect.any(Object),
            }),
        },
        f.host,
    );
    expect(f.upgrade).toHaveBeenCalledWith(
        expect.objectContaining({ id: "operation-1", expectedPreviousDigest: digest }),
        f.host,
    );
    expect(f.output.mock.calls.some(call => call[0].includes("操作 ID：operation-1"))).toBe(true);
});

it("交互摘要取消不准备候选", async () => {
    const f = fixture();
    const prompt = { ask: vi.fn(async () => ["no"]), report: vi.fn() };
    expect(
        await runManagerProgramUpdate(
            { check: false, yes: false, system: false },
            { ...f, interactive: true, prompt },
        ),
    ).toBe(0);
    expect(prompt.ask.mock.calls[0][0].detail).toContain(archiveSha256);
    expect(f.prepare).not.toHaveBeenCalled();
});

it("未知结果保留同一操作ID并指向候选查询和服务对账", async () => {
    const f = fixture();
    f.upgrade.mockRejectedValue(new Error("unknown"));
    await expect(
        runManagerProgramUpdate(
            { check: false, yes: true, system: false, version: "1.2.13" },
            { ...f, interactive: false },
        ),
    ).rejects.toThrow("recover --operation operation-1");
    expect(f.upgrade).toHaveBeenCalledOnce();
});

it("已有服务事务只引导recover，不解析版本或重派", async () => {
    const f = fixture();
    f.operationExists.mockReturnValue(true);
    expect(
        await runManagerProgramUpdate(
            { check: false, yes: true, system: true, operationId: "original" },
            { ...f, host: { ...f.host, uid: 0 }, interactive: false },
        ),
    ).toBe(1);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.upgrade).not.toHaveBeenCalled();
    expect(f.output.mock.calls[0][0]).toContain("recover --operation original --system");
});

it("Windows明确拒绝且无发布或安装副作用", async () => {
    const f = fixture();
    await expect(
        runManagerProgramUpdate(
            { check: true, yes: false, system: false },
            { ...f, host: { ...f.host, platform: "win32" }, interactive: false },
        ),
    ).rejects.toThrow("Windows");
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.inspect).not.toHaveBeenCalled();
});

it("隐式latest低于当前版本标记ahead且禁止降级，显式精确目标允许确认", async () => {
    const f = fixture();
    f.inspect.mockReturnValue({ version: "1.2.14", digest });
    expect(
        await runManagerProgramUpdate(
            { check: false, yes: true, system: false },
            { ...f, interactive: false },
        ),
    ).toBe(0);
    expect(JSON.parse(f.output.mock.calls[0][0]).state).toBe("ahead");
    expect(f.prepare).not.toHaveBeenCalled();

    f.output.mockClear();
    expect(
        await runManagerProgramUpdate(
            { check: true, yes: false, system: false, version: "1.2.13" },
            { ...f, interactive: false },
        ),
    ).toBe(2);
    expect(JSON.parse(f.output.mock.calls[0][0]).state).toBe("target_selected");
    f.output.mockClear();
    expect(
        await runManagerProgramUpdate(
            { check: false, yes: true, system: false, version: "1.2.13" },
            { ...f, interactive: false },
        ),
    ).toBe(0);
    expect(f.prepare).toHaveBeenCalledOnce();
});

it("--operation查询原候选在非交互模式不要求重复--yes", async () => {
    const f = fixture();
    expect(
        await runManagerProgramUpdate(
            {
                check: false,
                yes: false,
                system: false,
                operationId: "operation-1",
            },
            { ...f, interactive: false },
        ),
    ).toBe(0);
    expect(f.resume).toHaveBeenCalledWith("operation-1", "user", digest, f.host, undefined);
    expect(f.resolve).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.upgrade).toHaveBeenCalledOnce();
});

it("明确的候选拒绝不冒充unknown，也不禁止修复后创建新操作", async () => {
    const f = fixture();
    f.prepare.mockRejectedValue(new ManagerUpgradeCandidateRejectedError("rejected"));
    await expect(
        runManagerProgramUpdate(
            { check: false, yes: true, system: false },
            { ...f, interactive: false },
        ),
    ).rejects.toThrow("明确拒绝");
    await expect(
        runManagerProgramUpdate(
            { check: false, yes: true, system: false },
            { ...f, interactive: false },
        ),
    ).rejects.not.toThrow("禁止重新");
});

it("服务切换在外部效果前拒绝时不输出unknown恢复禁令", async () => {
    const f = fixture();
    f.upgrade.mockRejectedValue(new ManagerServiceUpgradeRejectedError("cas changed"));
    const result = runManagerProgramUpdate(
        { check: false, yes: true, system: false },
        { ...f, interactive: false },
    );
    await expect(result).rejects.toThrow("系统效果派发前被明确拒绝");
    await expect(result).rejects.not.toThrow("结果尚未确认");
});
