import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GenerationStore, type GenerationVerification } from "./generation-store.js";

vi.mock("node:fs", async original => {
    const actual = await original<typeof import("node:fs")>();
    return { ...actual, default: { ...actual, renameSync: vi.fn(actual.renameSync) } };
});
const folders: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of folders.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-generations-"));
    folders.push(root);
    const active = new Set<string>();
    const options = { root, isActive: (id: string) => active.has(id) };
    const store = new GenerationStore(options);
    const planDigest = "a".repeat(64);
    const evidence: GenerationVerification = {
        planDigest,
        hostVersion: "1.2.3",
        coreVersion: "2.3.4",
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
    };
    const candidate = store.allocate("operation-1", planDigest);
    const fill = () => {
        for (const [name, version] of [
            ["onebots", evidence.hostVersion],
            ["@onebots/core", evidence.coreVersion],
        ]) {
            const directory = path.join(candidate.directory, "node_modules", name);
            fs.mkdirSync(directory, { recursive: true });
            fs.writeFileSync(
                path.join(directory, "package.json"),
                JSON.stringify({ name, version }),
            );
        }
        fs.writeFileSync(
            path.join(candidate.directory, "pnpm-lock.yaml"),
            "lockfileVersion: '9.0'\n",
        );
        fs.writeFileSync(path.join(candidate.directory, "schemas.json"), '{"adapters":{}}');
    };
    return {
        root,
        active,
        store,
        evidence,
        candidate,
        fill,
        reopen: () => new GenerationStore(options),
    };
}

describe("generation store", () => {
    it("分配唯一私有候选，下载文件不能自行成为已验证版本", () => {
        const test = fixture();
        test.fill();
        const other = test.store.allocate("operation-1", test.evidence.planDigest);
        expect(other.id).not.toBe(test.candidate.id);
        expect(() => test.store.readVerified(test.candidate.id)).toThrow();
        expect(() =>
            test.store.commitVerified(test.candidate.id, {
                ...test.evidence,
                checks: {},
            } as GenerationVerification),
        ).toThrow("证据不完整");
        expect(() =>
            test.store.commitVerified(test.candidate.id, {
                ...test.evidence,
                planDigest: "b".repeat(64),
            }),
        ).toThrow("计划");
        if (process.platform !== "win32") {
            expect(fs.statSync(test.candidate.directory).mode & 0o777).toBe(0o700);
            expect(
                fs.statSync(path.join(test.candidate.directory, "candidate.json")).mode & 0o777,
            ).toBe(0o600);
        }
    });

    it("提交绑定完整证据，重启可读且禁止重写/丢弃已验证版本", () => {
        const test = fixture();
        test.fill();
        const input = {
            ...test.evidence,
            token: "synthetic-secret",
        };
        const verified = test.store.commitVerified(test.candidate.id, input);
        expect(verified.receipt.phase).toBe("verified");
        expect(test.reopen().readVerified(verified.id)).toEqual(verified);
        expect(JSON.stringify(verified.receipt)).not.toContain("synthetic-secret");
        expect(() => test.store.commitVerified(verified.id, test.evidence)).toThrow("禁止改写");
        expect(() => test.store.discard(verified.id)).toThrow("已有收据");
    });

    it.each(["pnpm-lock.yaml", "schemas.json"])("检测验证后 %s 改变", file => {
        const test = fixture();
        test.fill();
        test.store.commitVerified(test.candidate.id, test.evidence);
        fs.appendFileSync(path.join(test.candidate.directory, file), "\n");
        expect(() => test.reopen().readVerified(test.candidate.id)).toThrow("已变化");
    });

    it("要求宿主/core实际版本一致，也发现不改版本号的manifest变化", () => {
        const test = fixture();
        expect(() => test.store.commitVerified(test.candidate.id, test.evidence)).toThrow();
        test.fill();
        expect(() =>
            test.store.commitVerified(test.candidate.id, {
                ...test.evidence,
                hostVersion: "9.9.9",
            }),
        ).toThrow("身份不匹配");
        test.store.commitVerified(test.candidate.id, test.evidence);
        fs.appendFileSync(
            path.join(test.candidate.directory, "node_modules/onebots/package.json"),
            "\n",
        );
        expect(() => test.store.readVerified(test.candidate.id)).toThrow("已变化");
    });

    it("拒绝ABI错误、损坏收据和被修改的仓库所有权", () => {
        const test = fixture();
        test.fill();
        expect(() =>
            test.store.commitVerified(test.candidate.id, { ...test.evidence, nodeAbi: "wrong" }),
        ).toThrow("运行环境");
        test.store.commitVerified(test.candidate.id, test.evidence);
        const receiptFile = path.join(test.candidate.directory, "receipt.json");
        fs.writeFileSync(receiptFile, "{}");
        expect(() => test.store.readVerified(test.candidate.id)).toThrow();
        const candidateFile = path.join(test.candidate.directory, "candidate.json");
        const owned = JSON.parse(fs.readFileSync(candidateFile, "utf8"));
        fs.writeFileSync(candidateFile, JSON.stringify({ ...owned, storeId: "other-store" }));
        expect(() => test.store.discard(test.candidate.id)).toThrow("所有权");
    });

    it("提交中断保留候选，重开不能视为已验证但可重试", () => {
        const test = fixture();
        test.fill();
        vi.mocked(fs.renameSync).mockImplementationOnce(() => {
            throw new Error("simulated interrupted commit");
        });
        expect(() => test.store.commitVerified(test.candidate.id, test.evidence)).toThrow(
            "interrupted",
        );
        expect(() => test.reopen().readVerified(test.candidate.id)).toThrow();
        expect(fs.readdirSync(test.candidate.directory).some(name => name.endsWith(".tmp"))).toBe(
            false,
        );
        expect(test.reopen().commitVerified(test.candidate.id, test.evidence).receipt.phase).toBe(
            "verified",
        );
    });

    it("只删除本仓库非活动候选，不能用任意路径删除数据", () => {
        const test = fixture();
        test.active.add(test.candidate.id);
        expect(() => test.store.discard(test.candidate.id)).toThrow("活动版本");
        test.active.clear();
        expect(() => test.store.discard("../outside")).toThrow("标识");
        test.store.discard(test.candidate.id);
        expect(fs.existsSync(test.candidate.directory)).toBe(false);
        expect(fs.existsSync(path.join(test.root, "store.json"))).toBe(true);
    });

    it("允许pnpm内部链接，但拒绝宿主、Schema及candidate目录逃逸", () => {
        const test = fixture();
        test.fill();
        const host = path.join(test.candidate.directory, "node_modules/onebots");
        const internal = path.join(test.candidate.directory, "node_modules/.pnpm/host");
        fs.mkdirSync(path.dirname(internal), { recursive: true });
        fs.renameSync(host, internal);
        fs.symlinkSync(internal, host, "dir");
        expect(test.store.commitVerified(test.candidate.id, test.evidence).receipt.phase).toBe(
            "verified",
        );
        fs.unlinkSync(host);
        fs.symlinkSync(test.root, host, "dir");
        fs.writeFileSync(
            path.join(test.root, "package.json"),
            JSON.stringify({ name: "onebots", version: test.evidence.hostVersion }),
        );
        expect(() => test.store.readVerified(test.candidate.id)).toThrow("之外");
        fs.unlinkSync(host);
        fs.symlinkSync(internal, host, "dir");
        const schemas = path.join(test.candidate.directory, "schemas.json");
        fs.unlinkSync(schemas);
        fs.symlinkSync(path.join(test.root, "package.json"), schemas);
        expect(() => test.store.readVerified(test.candidate.id)).toThrow("常规文件");
        const relocated = path.join(test.root, "relocated");
        fs.renameSync(test.candidate.directory, relocated);
        fs.symlinkSync(relocated, test.candidate.directory, "dir");
        expect(() => test.store.discard(test.candidate.id)).toThrow("目录归属");
    });
});
