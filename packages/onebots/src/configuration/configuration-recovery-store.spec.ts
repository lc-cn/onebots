import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationRecoveryStore } from "./configuration-recovery-store.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-recovery-"));
    roots.push(root);
    const directory = path.join(root, "backups");
    const store = new ConfigurationRecoveryStore(directory);
    const bytes = Buffer.from("密码: [private-secret\r\n");
    const snapshot = { bytes, revision: createHash("sha256").update(bytes).digest("hex") };
    return { root, directory, store, snapshot };
}
describe("原始配置私有备份", () => {
    it("按opaque引用保留字节与权限，重开可读且无源依赖", () => {
        const { directory, store, snapshot } = fixture();
        const original = Buffer.from(snapshot.bytes);
        const ref = store.backup(snapshot);
        snapshot.bytes.fill(0);
        expect(new ConfigurationRecoveryStore(directory).read(ref).equals(original)).toBe(true);
        expect(ref).toEqual({
            backupId: expect.stringMatching(/^[a-f0-9-]{36}$/),
            originalRevision: snapshot.revision,
        });
        expect(JSON.stringify(ref)).not.toContain("private-secret");
        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
        expect(fs.statSync(path.join(directory, `${ref.backupId}.yaml`)).mode & 0o777).toBe(0o400);
    });
    it("声明摘要错误和持久化失败不产生可用备份", () => {
        const { store, snapshot, directory } = fixture();
        expect(() => store.backup({ ...snapshot, revision: "0".repeat(64) })).toThrow();
        const sync = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
            throw new Error("secret filesystem");
        });
        expect(() => store.backup(snapshot)).toThrow(/^配置原始备份不可用/);
        sync.mockRestore();
        expect(fs.readdirSync(directory)).toEqual([]);
    });
    it("篡改、硬链、越界引用和链接目录均拒绝", () => {
        const { store, snapshot, directory, root } = fixture();
        const ref = store.backup(snapshot);
        expect(() => store.read({ ...ref, backupId: "../escape" })).toThrow();
        const file = path.join(directory, `${ref.backupId}.yaml`);
        fs.linkSync(file, path.join(root, "hardlink"));
        expect(() => store.read(ref)).toThrow();
        fs.unlinkSync(path.join(root, "hardlink"));
        fs.chmodSync(file, 0o600);
        fs.writeFileSync(file, "changed");
        fs.chmodSync(file, 0o400);
        expect(() => store.read(ref)).toThrow();
        const alias = path.join(root, "alias");
        fs.symlinkSync(directory, alias);
        expect(() => new ConfigurationRecoveryStore(alias)).toThrow();
    });
    it("目录替换后旧store拒绝读取", () => {
        const { store, snapshot, directory, root } = fixture();
        const ref = store.backup(snapshot);
        fs.renameSync(directory, path.join(root, "old"));
        fs.mkdirSync(directory, { mode: 0o700 });
        expect(() => store.read(ref)).toThrow();
    });
});
