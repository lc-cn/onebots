import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "migration-files-")));
    roots.push(root);
    const bytes = Buffer.from([255, 0, 13, 10, 65]);
    const files = (["definition", "metadata", "configuration"] as const).map((role, index) => {
        const file = path.join(root, role);
        const mode = index === 0 ? 0o644 : 0o600;
        fs.writeFileSync(file, bytes, { mode });
        return { role, path: file, mode, contentBase64: bytes.toString("base64") };
    });
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: root,
            nodePath: "/tmp/node",
            binPath: "/tmp/bin.js",
            workingDirectory: root,
            host: "127.0.0.1",
            port: 6727,
        },
        previousRunning: true,
        previousEnabled: true,
        files,
    };
    const targets = [
        { path: files[0].path, bytes: Buffer.from("target\n"), mode: 0o600 },
        {
            path: path.join(root, "new-config.yaml"),
            bytes: Buffer.from("plugins: {}\n"),
            mode: 0o644,
        },
    ];
    return { root, bytes, backup, targets, boundary: new ServiceMigrationFiles(backup, targets) };
}
describe("migration file CAS and recovery", () => {
    it("writes exact target bytes and modes while preserving untouched originals; restores original binary bytes", () => {
        const test = fixture();
        expect(test.boundary.matchesOriginal()).toBe(true);
        test.boundary.apply();
        expect(test.boundary.matchesTarget()).toBe(true);
        expect(fs.readFileSync(test.backup.files[1].path)).toEqual(test.bytes);
        expect(fs.statSync(test.targets[1].path).mode & 0o777).toBe(0o644);
        expect(test.boundary.canRestore()).toBe(true);
        test.boundary.restore();
        expect(test.boundary.matchesOriginal()).toBe(true);
        expect(fs.existsSync(test.targets[1].path)).toBe(false);
        expect(fs.readFileSync(test.backup.files[0].path)).toEqual(test.bytes);
        expect(fs.statSync(test.backup.files[0].path).mode & 0o777).toBe(0o644);
    });
    it("partially written targets remain recoverable after a later file fails", () => {
        const test = fixture();
        vi.spyOn(fs, "linkSync").mockImplementation(() => {
            throw new Error("synthetic-secret");
        });
        expect(() => test.boundary.apply()).toThrow("服务迁移文件已变化或不可用");
        expect(fs.readFileSync(test.targets[0].path)).toEqual(test.targets[0].bytes);
        expect(test.boundary.canRestore()).toBe(true);
        vi.restoreAllMocks();
        test.boundary.restore();
        expect(test.boundary.matchesOriginal()).toBe(true);
    });
    it("third-party content or mode changes block all restore writes", () => {
        const test = fixture();
        test.boundary.apply();
        fs.writeFileSync(test.targets[1].path, "external");
        expect(test.boundary.canRestore()).toBe(false);
        expect(() => test.boundary.restore()).toThrow();
        expect(fs.readFileSync(test.targets[0].path)).toEqual(test.targets[0].bytes);
        fs.writeFileSync(test.targets[1].path, test.targets[1].bytes);
        fs.chmodSync(test.targets[1].path, 0o600);
        expect(test.boundary.canRestore()).toBe(false);
    });
    it("checks all originals before applying and rejects dangling links or hardlinks", () => {
        const test = fixture();
        fs.symlinkSync(path.join(test.root, "missing"), test.targets[1].path);
        expect(() => test.boundary.apply()).toThrow();
        expect(fs.readFileSync(test.targets[0].path)).toEqual(test.bytes);
        fs.unlinkSync(test.targets[1].path);
        fs.linkSync(test.backup.files[1].path, path.join(test.root, "alias"));
        expect(test.boundary.matchesOriginal()).toBe(false);
        expect(() => test.boundary.apply()).toThrow();
    });
    it("new target creation is no-clobber even when an entry appears after its last read", () => {
        const test = fixture();
        const original = fs.linkSync;
        vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
            fs.symlinkSync(path.join(test.root, "missing"), String(to));
            original(from, to);
        });
        expect(() => test.boundary.apply()).toThrow();
        expect(fs.lstatSync(test.targets[1].path).isSymbolicLink()).toBe(true);
        expect(test.boundary.canRestore()).toBe(false);
    });
    it("rejects aliases, relative paths, duplicate roles, unsafe bytes and copies caller buffers", () => {
        const test = fixture();
        expect(
            () => new ServiceMigrationFiles(test.backup, [...test.targets, test.targets[0]]),
        ).toThrow();
        expect(
            () =>
                new ServiceMigrationFiles(test.backup, [{ ...test.targets[0], path: "relative" }]),
        ).toThrow();
        expect(
            () =>
                new ServiceMigrationFiles(test.backup, [
                    { ...test.targets[0], bytes: Buffer.alloc(1_048_577) },
                ]),
        ).toThrow();
        const backup = structuredClone(test.backup);
        backup.files[0].role = "metadata";
        expect(() => new ServiceMigrationFiles(backup, test.targets)).toThrow();
        test.targets[0].bytes.fill(0);
        test.boundary.apply();
        expect(fs.readFileSync(test.targets[0].path, "utf8")).toBe("target\n");
    });
    it("private staging remains inaccessible while target permissions are prepared", () => {
        const test = fixture();
        const original = fs.fchmodSync;
        vi.spyOn(fs, "fchmodSync").mockImplementation((fd, mode) => {
            const staging = fs
                .readdirSync(test.root)
                .find(name => name.startsWith(".onebots-migration-"));
            expect(staging).toBeDefined();
            expect(fs.statSync(path.join(test.root, staging!)).mode & 0o777).toBe(0o700);
            original(fd, mode);
        });
        test.boundary.apply();
        expect(fs.readdirSync(test.root).some(name => name.startsWith(".onebots-migration-"))).toBe(
            false,
        );
    });
});

it("special permission bits are not silently discarded when comparing original modes", () => {
    const test = fixture();
    const original = fs.lstatSync;
    vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
        const stat = original(file, options);
        if (String(file) === test.backup.files[0].path && typeof stat.mode === "number")
            stat.mode |= 0o4000;
        return stat;
    });
    expect(test.boundary.matchesOriginal()).toBe(false);
    expect(() => test.boundary.apply()).toThrow();
});
