import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, expect, it } from "vitest";
import { GenerationStore, readVerifiedGeneration } from "../installation/generation-store.js";
import { readVerifiedManagerCandidate } from "./reader.js";
import { managerCandidateDigest, readRunningManagerCandidate } from "./identity.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-identity-"));
    roots.push(temporary);
    const root = fs.realpathSync(temporary);
    const store = new GenerationStore({ root, isActive: () => false });
    const candidate = store.allocate("install", "a".repeat(64));
    for (const name of ["onebots", "@onebots/core"]) {
        const folder = path.join(candidate.directory, "node_modules", name);
        fs.mkdirSync(folder, { recursive: true });
        fs.writeFileSync(
            path.join(folder, "package.json"),
            JSON.stringify({ name, version: "1.2.3" }),
        );
    }
    const host = path.join(candidate.directory, "node_modules/onebots/lib/control/host.js");
    fs.mkdirSync(path.dirname(host), { recursive: true });
    fs.writeFileSync(host, "export {};\n");
    fs.writeFileSync(path.join(candidate.directory, "pnpm-lock.yaml"), "lock\n");
    fs.writeFileSync(path.join(candidate.directory, "schemas.json"), "{}");
    const verified = store.commitVerified(candidate.id, {
        planDigest: candidate.planDigest,
        hostVersion: "1.2.3",
        coreVersion: "1.2.3",
        nodeAbi: process.versions.modules,
        platform: process.platform,
        arch: process.arch,
        checks: {
            packageIdentity: true,
            peerDependencies: true,
            singleHost: true,
            loadRegistration: true,
            schemas: true,
        },
    });
    const management = {
        schemaVersion: 1,
        planDigest: candidate.planDigest,
        hostVersion: "1.2.3",
        coreVersion: "1.2.3",
        nodeAbi: process.versions.modules,
        platform: process.platform,
        arch: process.arch,
        checks: {
            managementStartup: true,
            webAssets: true,
            anonymousDenied: true,
            maintenance: true,
            closed: true,
        },
    };
    fs.writeFileSync(
        path.join(candidate.directory, "manager-verification.json"),
        JSON.stringify({ schemaVersion: 1, candidateId: candidate.id, verification: management }),
        { mode: 0o600 },
    );
    return { root, candidate, host, verified };
}
function snapshot(root: string): string {
    const walk = (directory: string): unknown[] =>
        fs
            .readdirSync(directory)
            .sort()
            .map(name => {
                const file = path.join(directory, name),
                    stat = fs.lstatSync(file);
                return [
                    name,
                    stat.mode,
                    stat.mtimeMs,
                    stat.isDirectory()
                        ? walk(file)
                        : stat.isSymbolicLink()
                          ? fs.readlinkSync(file)
                          : fs.readFileSync(file).toString("base64"),
                ];
            });
    return JSON.stringify(walk(root));
}
it("只读从实际host入口确认双收据，不创建文件或修复权限", () => {
    const f = fixture(),
        before = snapshot(f.root);
    expect(readVerifiedGeneration(f.root, f.candidate.id)).toEqual(f.verified);
    const candidate = readRunningManagerCandidate(pathToFileURL(f.host).href);
    expect(candidate).toEqual(readVerifiedManagerCandidate(f.root, f.candidate.id));
    expect(managerCandidateDigest(candidate)).toMatch(/^[a-f0-9]{64}$/);
    expect(managerCandidateDigest({ ...candidate, id: "b".repeat(36) })).not.toBe(
        managerCandidateDigest(candidate),
    );
    expect(snapshot(f.root)).toBe(before);
});
it("缺失仓库不会创建目录或store身份", () => {
    const f = fixture(),
        missing = path.join(f.root, "missing"),
        before = snapshot(f.root);
    expect(() => readVerifiedGeneration(missing, f.candidate.id)).toThrow();
    fs.unlinkSync(path.join(f.root, "store.json"));
    const without = snapshot(f.root);
    expect(() => readVerifiedGeneration(f.root, f.candidate.id)).toThrow();
    expect(snapshot(f.root)).toBe(without);
    expect(fs.existsSync(missing)).toBe(false);
    expect(before).not.toBe(without);
});
it("拒绝错误候选归属及缺失管理证明", () => {
    const f = fixture(),
        receipt = path.join(f.candidate.directory, "receipt.json");
    const value = JSON.parse(fs.readFileSync(receipt, "utf8"));
    fs.writeFileSync(receipt, JSON.stringify({ ...value, storeId: "0".repeat(36) }));
    expect(() => readRunningManagerCandidate(pathToFileURL(f.host).href)).toThrow();
    fs.writeFileSync(receipt, JSON.stringify(value));
    fs.unlinkSync(path.join(f.candidate.directory, "manager-verification.json"));
    expect(() => readRunningManagerCandidate(pathToFileURL(f.host).href)).toThrow();
});
it("拒绝候选内错误入口、外置宿主及非file URL", () => {
    const f = fixture(),
        wrong = path.join(path.dirname(f.host), "other.js");
    fs.copyFileSync(f.host, wrong);
    expect(() => readRunningManagerCandidate(pathToFileURL(wrong).href)).toThrow();
    const outside = path.join(f.root, "outside.js");
    fs.renameSync(f.host, outside);
    fs.symlinkSync(outside, f.host);
    expect(() => readRunningManagerCandidate(pathToFileURL(f.host).href)).toThrow();
    expect(() => readRunningManagerCandidate("https://example.test/host.js")).toThrow();
});
it("支持pnpm候选内部宿主链接，拒绝链接仓库且不修改其权限", () => {
    const f = fixture(),
        direct = path.join(f.candidate.directory, "node_modules/onebots");
    const internal = path.join(
        f.candidate.directory,
        "node_modules/.pnpm/onebots@1.2.3/node_modules/onebots",
    );
    fs.mkdirSync(path.dirname(internal), { recursive: true });
    fs.renameSync(direct, internal);
    fs.symlinkSync(path.relative(path.dirname(direct), internal), direct);
    expect(
        readRunningManagerCandidate(pathToFileURL(path.join(internal, "lib/control/host.js")).href)
            .id,
    ).toBe(f.candidate.id);
    const alias = path.join(f.root, "alias");
    fs.symlinkSync(f.root, alias);
    expect(() => readVerifiedGeneration(alias, f.candidate.id)).toThrow();
    fs.chmodSync(f.root, 0o755);
    expect(() => readVerifiedGeneration(f.root, f.candidate.id)).toThrow();
    expect(fs.statSync(f.root).mode & 0o777).toBe(0o755);
});
