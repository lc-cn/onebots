import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import type { GenerationPlan } from "./installation/generation-plan.js";
import {
    ManagerUpgradeCandidateRejectedError,
    prepareManagerUpgradeCandidate,
    resumeManagerUpgradeCandidate,
} from "./manager-service-upgrade-preparation.js";

const mock = vi.hoisted(() => ({
    install: vi.fn(),
    status: vi.fn(),
    read: vi.fn(),
    close: vi.fn(),
    verify: vi.fn(),
    digest: vi.fn(),
}));
vi.mock("./manager-runtime/installer.js", () => ({
    ManagerCandidateInstaller: class {
        install = mock.install;
        status = mock.status;
        readCandidate = mock.read;
        close = mock.close;
    },
}));
vi.mock("./manager-runtime/identity.js", () => ({ managerCandidateDigest: mock.digest }));
vi.mock("./manager-service-upgrade-candidate.js", () => ({
    verifyManagerServiceCandidate: mock.verify,
}));

const roots: string[] = [];
afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-upgrade-preparation-"));
    roots.push(root);
    const state = path.join(root, "state", "onebots");
    fs.mkdirSync(state, { recursive: true, mode: 0o700 });
    const current = path.join(root, "current");
    fs.mkdirSync(current, { mode: 0o700 });
    const metadata = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: path.join(root, "workspace"),
        workingDirectory: current,
        nodePath: process.execPath,
        binPath: path.join(current, "node_modules/onebots/lib/bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    fs.writeFileSync(path.join(state, "service.json"), JSON.stringify(metadata), { mode: 0o600 });
    const host = {
        platform: "linux" as const,
        homedir: root,
        uid: process.getuid?.() ?? 1000,
        env: { XDG_STATE_HOME: path.join(root, "state") },
        exec: vi.fn(),
        spawn: vi.fn(),
    };
    const id = "10000000-0000-4000-8000-000000000001";
    const candidate = {
        id: "20000000-0000-4000-8000-000000000002",
        directory: path.join(
            state,
            "manager-artifacts/versions/20000000-0000-4000-8000-000000000002",
        ),
        operationId: `upgrade-${id}`,
        planDigest: "",
        receipt: { hostVersion: "1.2.13" },
    };
    const request = {
        id,
        scope: "user" as const,
        expectedPreviousDigest: "a".repeat(64),
        archiveSha256: createHash("sha256").update("host archive").digest("hex"),
        artifacts: {
            host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
            core: { name: "@onebots/core", version: "1.2.13", spec: "1.2.13" },
        },
        archives: {
            host: {
                bytes: Buffer.from("host archive"),
                sha256: createHash("sha256").update("host archive").digest("hex"),
            },
            core: {
                bytes: Buffer.from("core archive"),
                sha256: createHash("sha256").update("core archive").digest("hex"),
            },
        },
    };
    mock.install.mockImplementation(async (_id: string, plan: GenerationPlan) => {
        candidate.planDigest = plan.digest;
        const result = { phase: "verified", planDigest: plan.digest, candidateId: candidate.id };
        mock.status.mockReturnValue(result);
        return result;
    });
    mock.read.mockReturnValue(candidate);
    mock.digest.mockReturnValue("c".repeat(64));
    return { root, state, host, id, candidate, request, metadata };
}

it("先持久化发布摘要和当前身份，再安装及双证明候选；重复调用只查询原安装", async () => {
    const f = fixture();
    const result = await prepareManagerUpgradeCandidate(f.request, f.host);
    expect(result).toEqual({
        operationId: f.id,
        candidateDirectory: f.candidate.directory,
        candidateDigest: "c".repeat(64),
        targetVersion: "1.2.13",
    });
    expect(mock.verify).toHaveBeenNthCalledWith(1, f.metadata, "a".repeat(64));
    expect(mock.verify).toHaveBeenNthCalledWith(
        2,
        {
            ...f.metadata,
            workingDirectory: f.candidate.directory,
            binPath: path.join(f.candidate.directory, "node_modules/onebots/lib/bin.js"),
        },
        "c".repeat(64),
    );
    const binding = path.join(f.state, "manager-artifacts/upgrades", f.id);
    expect(JSON.parse(fs.readFileSync(path.join(binding, "intent.json"), "utf8"))).toMatchObject({
        expectedPreviousDigest: "a".repeat(64),
        archiveSha256: f.request.archiveSha256,
        targetVersion: "1.2.13",
    });
    expect(mock.install).toHaveBeenCalledWith(
        `upgrade-${f.id}`,
        expect.objectContaining({
            host: expect.objectContaining({
                spec: `file:${path.join(f.state, "manager-artifacts/artifacts", `${f.request.archives.host.sha256}.tgz`)}`,
                sha256: f.request.archives.host.sha256,
            }),
            core: expect.objectContaining({
                spec: `file:${path.join(f.state, "manager-artifacts/artifacts", `${f.request.archives.core.sha256}.tgz`)}`,
                sha256: f.request.archives.core.sha256,
            }),
        }),
    );
    expect(await prepareManagerUpgradeCandidate(f.request, f.host)).toEqual(result);
    expect(mock.install).toHaveBeenCalledOnce();
    expect(mock.status).toHaveBeenCalledWith(`upgrade-${f.id}`);
    expect(mock.close).toHaveBeenCalledTimes(2);
});

it("安装结果未知后只查询原操作，不重派下载", async () => {
    const f = fixture();
    mock.install.mockRejectedValue(new Error("unknown"));
    await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toThrow("结果尚未确认");
    mock.status.mockImplementation(() => {
        throw new Error("missing original journal");
    });
    await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toThrow("结果尚未确认");
    expect(mock.install).toHaveBeenCalledOnce();
    expect(
        fs.existsSync(path.join(f.state, "manager-artifacts/upgrades", f.id, "intent.json")),
    ).toBe(true);
});

it("变更目标版本、发布摘要或活动管理摘要均不能复用原操作", async () => {
    for (const change of ["version", "archive", "previous"] as const) {
        const f = fixture();
        await prepareManagerUpgradeCandidate(f.request, f.host);
        if (change === "version") {
            f.request.artifacts.host.version = "1.2.14";
            f.request.artifacts.host.spec = "1.2.14";
        } else if (change === "archive") f.request.archiveSha256 = "d".repeat(64);
        else f.request.expectedPreviousDigest = "e".repeat(64);
        await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toThrow();
        expect(mock.install).toHaveBeenCalledOnce();
        fs.rmSync(f.root, { recursive: true, force: true });
        roots.splice(roots.indexOf(f.root), 1);
        vi.resetAllMocks();
    }
});

it("摘要必须匹配实际宿主和core归档字节，失配时不安装", async () => {
    for (const component of ["host", "core"] as const) {
        const f = fixture();
        f.request.archives[component].bytes = Buffer.from("tampered archive");
        await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toThrow();
        expect(mock.install).not.toHaveBeenCalled();
        fs.rmSync(f.root, { recursive: true, force: true });
        roots.splice(roots.indexOf(f.root), 1);
        vi.resetAllMocks();
    }
});

it("安装器明确失败可与中断状态区分，且仍不由原操作重派", async () => {
    const f = fixture();
    mock.install.mockImplementation(async (_id: string, plan: GenerationPlan) => {
        const result = { phase: "failed", planDigest: plan.digest };
        mock.status.mockReturnValue(result);
        return result;
    });
    await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toMatchObject({
        name: "Error",
        message: expect.stringContaining("被拒绝"),
    });
    await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toThrow("被拒绝");
    expect(mock.install).toHaveBeenCalledOnce();
    expect(mock.status).toHaveBeenCalledOnce();
});

it("恢复仅从持久意图、原安装操作和候选收据读取，不需要发布归档输入", async () => {
    const f = fixture();
    const prepared = await prepareManagerUpgradeCandidate(f.request, f.host);
    const intentFile = path.join(f.state, "manager-artifacts/upgrades", f.id, "intent.json");
    const candidateFile = path.join(f.state, "manager-artifacts/upgrades", f.id, "candidate.json");
    const before = [fs.readFileSync(intentFile), fs.readFileSync(candidateFile)];
    fs.rmSync(path.join(f.state, "manager-artifacts/resolved-artifacts"), {
        recursive: true,
        force: true,
    });
    fs.rmSync(path.join(f.state, "manager-artifacts/artifacts"), {
        recursive: true,
        force: true,
    });
    const resumed = await resumeManagerUpgradeCandidate(
        f.id,
        "user",
        f.request.expectedPreviousDigest,
        f.host,
    );
    expect(resumed).toMatchObject(prepared);
    expect(resumed).toMatchObject({
        archiveSha256: f.request.archives.host.sha256,
        coreArchiveSha256: f.request.archives.core.sha256,
    });
    expect(mock.install).toHaveBeenCalledOnce();
    expect(mock.status).toHaveBeenCalledWith(`upgrade-${f.id}`);
    expect([fs.readFileSync(intentFile), fs.readFileSync(candidateFile)]).toEqual(before);
});

it.each([
    ["interrupted", "结果尚未确认"],
    ["failed", "被拒绝"],
] as const)("离线恢复保留%s与明确失败的差异", async (phase, message) => {
    const f = fixture();
    await prepareManagerUpgradeCandidate(f.request, f.host);
    mock.status.mockReturnValue({ phase, planDigest: f.candidate.planDigest });
    await expect(
        resumeManagerUpgradeCandidate(f.id, "user", f.request.expectedPreviousDigest, f.host),
    ).rejects.toThrow(message);
    expect(mock.install).toHaveBeenCalledOnce();
});

it("损坏管理服务metadata在安装派发前明确拒绝", async () => {
    const f = fixture();
    fs.writeFileSync(path.join(f.state, "service.json"), "{", { mode: 0o600 });
    await expect(prepareManagerUpgradeCandidate(f.request, f.host)).rejects.toBeInstanceOf(
        ManagerUpgradeCandidateRejectedError,
    );
    expect(mock.install).not.toHaveBeenCalled();
});
