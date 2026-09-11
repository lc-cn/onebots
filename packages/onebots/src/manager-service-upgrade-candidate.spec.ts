import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import { verifyManagerServiceCandidate } from "./manager-service-upgrade-candidate.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";

const identity = vi.hoisted(() => ({
    read: vi.fn(),
    digest: vi.fn(),
}));
vi.mock("./manager-runtime/identity.js", () => ({
    readRunningManagerCandidate: identity.read,
    managerCandidateDigest: identity.digest,
}));
const roots: string[] = [];
afterEach(() => {
    vi.resetAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-service-candidate-")));
    roots.push(root);
    const directory = path.join(root, "candidate");
    const binPath = path.join(directory, "node_modules/onebots/lib/bin.js");
    const hostPath = path.join(path.dirname(binPath), "control/host.js");
    fs.mkdirSync(path.dirname(hostPath), { recursive: true });
    fs.writeFileSync(binPath, "export {};\n");
    fs.writeFileSync(hostPath, "export {};\n");
    const candidate = { directory, management: { checks: { authenticationV2: true } } };
    identity.read.mockReturnValue(candidate);
    identity.digest.mockReturnValue("a".repeat(64));
    const spec: ManagerServiceSpec = {
        schemaVersion: 1, runtimeKind: "control", scope: "user",
        workspace: path.join(root, "data"), workingDirectory: directory,
        nodePath: process.execPath, binPath, host: "127.0.0.1", port: 6727,
    };
    return { root, candidate, spec, hostPath };
}
it("根据服务 bin 的实际相邻 host 核验并返回原候选，接受当前 Node 链接", () => {
    const f = fixture();
    const nodePath = path.join(f.root, "node");
    fs.symlinkSync(process.execPath, nodePath);
    expect(verifyManagerServiceCandidate({ ...f.spec, nodePath }, "a".repeat(64))).toBe(f.candidate);
    expect(identity.read).toHaveBeenCalledWith(pathToFileURL(f.hostPath).href);
    expect(identity.digest).toHaveBeenCalledWith(f.candidate);
});
it.each(["", "a".repeat(63), "A".repeat(64), "a".repeat(64) + "\n"])("拒绝非法摘要 %s，未读取候选", digest => {
    const f = fixture();
    expect(() => verifyManagerServiceCandidate(f.spec, digest)).toThrow("摘要无效");
    expect(identity.read).not.toHaveBeenCalled();
});
it("闭合解析服务契约且不调用 getter", () => {
    const f = fixture();
    const getter = vi.fn(() => f.spec.binPath);
    Object.defineProperty(f.spec, "binPath", { enumerable: true, get: getter });
    expect(() => verifyManagerServiceCandidate(f.spec, "a".repeat(64))).toThrow();
    expect(getter).not.toHaveBeenCalled();
    expect(identity.read).not.toHaveBeenCalled();
});
it.each(["digest", "authentication", "cwd", "bin", "node", "missing"])("拒绝不一致的 %s 证据", problem => {
    const f = fixture();
    if (problem === "digest") identity.digest.mockReturnValue("b".repeat(64));
    if (problem === "authentication") f.candidate.management.checks.authenticationV2 = false;
    if (problem === "cwd") f.spec.workingDirectory = f.root;
    if (problem === "bin" || problem === "node") {
        const other = path.join(f.root, "other.js");
        fs.writeFileSync(other, "export {};\n");
        if (problem === "bin") f.spec.binPath = other;
        else f.spec.nodePath = other;
    }
    if (problem === "missing") fs.unlinkSync(f.spec.binPath);
    expect(() => verifyManagerServiceCandidate(f.spec, "a".repeat(64))).toThrow();
});
it("双证明读取失败直接拒绝，不降级为路径或摘要验证", () => {
    const f = fixture();
    identity.read.mockImplementation(() => { throw new Error("invalid proof"); });
    expect(() => verifyManagerServiceCandidate(f.spec, "a".repeat(64))).toThrow("invalid proof");
    expect(identity.digest).not.toHaveBeenCalled();
});
it("拒绝候选 bin 指向目录外的脚本，即使两侧 realpath 一致", () => {
    const f = fixture();
    // 同前缀兄弟目录不能被误认为候选的子目录。
    const outside = path.join(f.candidate.directory + "-outside", "bin.js");
    fs.mkdirSync(path.dirname(outside));
    fs.writeFileSync(outside, "export {};\n");
    fs.unlinkSync(f.spec.binPath);
    fs.symlinkSync(outside, f.spec.binPath);
    expect(() => verifyManagerServiceCandidate(f.spec, "a".repeat(64))).toThrow("入口与已验证候选不一致");
});
it("拒绝候选 bin 是目录", () => {
    const f = fixture();
    fs.unlinkSync(f.spec.binPath);
    fs.mkdirSync(f.spec.binPath);
    expect(() => verifyManagerServiceCandidate(f.spec, "a".repeat(64))).toThrow("入口与已验证候选不一致");
});
it("接受候选目录内的 bin 链接", () => {
    const f = fixture();
    const actual = path.join(f.candidate.directory, "bin.js");
    fs.renameSync(f.spec.binPath, actual);
    fs.symlinkSync(actual, f.spec.binPath);
    expect(verifyManagerServiceCandidate(f.spec, "a".repeat(64))).toBe(f.candidate);
});
