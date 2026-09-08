import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
    resolveDockerRelease,
    switchDockerRelease,
    rollbackDockerRelease,
    writeJson,
    readReleaseState,
    RECEIPT,
    manageRelease,
} from "../../scripts/docker-extension-release.mjs";
import {
    makeInstallPlan,
    validateRegistryConfig,
} from "../../scripts/docker-extension-installer.mjs";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "onebots-releases-")));
    roots.push(root);
    return root;
}
function candidate(root: string, id: string, phase = "verified") {
    const directory = path.join(root, "releases", id);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    writeJson(path.join(directory, RECEIPT), {
        schemaVersion: 1,
        id,
        phase,
        fingerprint: "image-a",
        lockDigest: createHash("sha256").update("lockfileVersion: 9\n").digest("hex"),
    });
    return directory;
}
describe("Docker 候选扩展版本", () => {
    it("验证前不改变旧版本，切换后仍保留旧目录并可回滚", () => {
        const root = fixture();
        expect(resolveDockerRelease(root, "image-a")).toBe(root);
        const first = candidate(root, "first");
        switchDockerRelease(root, "first", "image-a");
        const next = candidate(root, "next", "downloaded");
        expect(() => switchDockerRelease(root, "next", "image-a")).toThrow("未验证");
        expect(resolveDockerRelease(root, "image-a")).toBe(first);
        candidate(root, "next");
        switchDockerRelease(root, "next", "image-a");
        expect(resolveDockerRelease(root, "image-a")).toBe(next);
        rollbackDockerRelease(root, "next", "image-a");
        expect(resolveDockerRelease(root, "image-a")).toBe(first);
        expect(fs.existsSync(next)).toBe(true);
    });
    it("首次隔离安装失败回滚时恢复原有持久化目录", () => {
        const root = fixture();
        candidate(root, "first");
        switchDockerRelease(root, "first", "image-a");
        rollbackDockerRelease(root, "first", "image-a");
        expect(resolveDockerRelease(root, "image-a")).toBe(root);
    });
    it("拒绝不同镜像、锁文件变更、越界路径和并发覆盖", () => {
        const root = fixture(),
            first = candidate(root, "first");
        switchDockerRelease(root, "first", "image-a");
        expect(() => resolveDockerRelease(root, "image-b")).toThrow("不兼容");
        expect(() => rollbackDockerRelease(root, "other", "image-a")).toThrow("其他操作");
        expect(() => switchDockerRelease(root, "../first", "image-a")).toThrow("标识");
        fs.writeFileSync(path.join(first, "pnpm-lock.yaml"), "changed");
        expect(() => resolveDockerRelease(root, "image-a")).toThrow("锁文件");
    });
    it("不同安装进程不能抢占或释放已有锁", () => {
        const root = fixture();
        manageRelease("init", root, "first");
        expect(() => manageRelease("init", root, "second")).toThrow();
        expect(() => manageRelease("unlock", root, "second")).toThrow("不属于");
        manageRelease("unlock", root, "first");
        expect(readReleaseState(root).current).toBeNull();
    });
    it("保留已有私有扩展并对齐当前目录，拒绝未受信任包", () => {
        const catalog = {
            packages: {
                "@onebots/adapter-icqq": { version: "3.0.14" },
                "@onebots/adapter-slack": { version: "3.0.8" },
            },
        };
        expect(makeInstallPlan(["slack"], catalog, { "@onebots/adapter-icqq": "3.0.13" })).toEqual({
            "@onebots/adapter-icqq": "3.0.14",
            "@onebots/adapter-slack": "3.0.8",
        });
        expect(() => makeInstallPlan(["evil"], catalog)).toThrow("不支持");
    });
    it("认证文件不能启用钩子、泄露 URL 凭据或回退到外部明文 HTTP", () => {
        expect(() =>
            validateRegistryConfig(
                Buffer.from(
                    "@icqqjs:registry=https://npm.pkg.github.com\n//npm.pkg.github.com/:_authToken=fake-token\n",
                ),
            ),
        ).not.toThrow();
        for (const config of [
            "pnpmfile=./hook.js",
            "registry=https://token:secret@example.com",
            "registry=https://example.com?token=secret",
            "registry=http://example.com",
            "node-options=--require=./evil",
        ])
            expect(() => validateRegistryConfig(Buffer.from(config))).toThrow();
    });
});
