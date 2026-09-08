import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServicePlatform } from "./service-platform.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(platform: "linux" | "darwin" = "darwin") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-manager-install-")));
    roots.push(root);
    const host: ServiceHost = {
        platform,
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: () => {
            throw new Error("no real OS call");
        },
        spawn: async () => {
            throw new Error("no spawn");
        },
    };
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: path.join(root, "data"),
        workingDirectory: root,
        nodePath: process.execPath,
        binPath: path.join(root, "bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    return { root, host, spec, files: getServiceFiles("user", host) };
}
describe("新管理服务首次安装文件端口", () => {
    it.each(["linux", "darwin"] as const)(
        "%s 准备只读，应用不要求配置/扩展且不启动",
        async platform => {
            const f = fixture(platform);
            fs.mkdirSync(f.spec.workspace);
            fs.writeFileSync(path.join(f.spec.workspace, "config.yaml"), "broken: [");
            fs.mkdirSync(path.join(f.spec.workspace, ".control"));
            fs.writeFileSync(path.join(f.spec.workspace, ".control/auth.json"), "preserve-auth");
            const plan = prepareManagerServiceInstallation(f.spec, f.host);
            expect(fs.existsSync(f.files.stateDir)).toBe(false);
            plan.apply();
            expect(plan.verify()).toBe(true);
            expect(JSON.parse(fs.readFileSync(f.files.metadata, "utf8"))).toEqual(f.spec);
            expect(fs.readFileSync(f.files.definition, "utf8")).toContain("serve");
            expect(fs.statSync(f.files.metadata).mode & 0o777).toBe(0o600);
            const driver: ServicePlatform = {
                inspect: vi.fn(async () => ({
                    state: "stopped",
                    running: false,
                    enabled: true,
                    loaded: platform === "linux",
                    definitionPath: f.files.definition,
                    processId: null,
                    identity: null,
                    quiescent: true,
                })),
                reload: vi.fn(async () => {}),
                start: vi.fn(async () => {
                    throw new Error("must never start");
                }),
                quiesce: vi.fn(async () => {
                    throw new Error("must never stop");
                }),
            };
            await plan.reload(driver, true);
            expect(driver.reload).toHaveBeenCalledExactlyOnceWith(true);
            expect(driver.start).not.toHaveBeenCalled();
            plan.rollback();
            expect(fs.existsSync(f.files.definition)).toBe(false);
            expect(fs.existsSync(f.files.metadata)).toBe(false);
            expect(fs.readFileSync(path.join(f.spec.workspace, "config.yaml"), "utf8")).toBe(
                "broken: [",
            );
            expect(fs.readFileSync(path.join(f.spec.workspace, ".control/auth.json"), "utf8")).toBe(
                "preserve-auth",
            );
        },
    );
    it.each(["definition", "metadata"] as const)("已有 %s 包括损坏文件都拒绝", key => {
        const f = fixture();
        const file = f.files[key];
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, "broken", { mode: 0o600 });
        expect(() => prepareManagerServiceInstallation(f.spec, f.host)).toThrow();
        expect(fs.readFileSync(file, "utf8")).toBe("broken");
    });
    it("prepare后出现新文件时拒绝，绝不覆盖或回退外部文件", () => {
        const f = fixture(),
            plan = prepareManagerServiceInstallation(f.spec, f.host);
        fs.mkdirSync(f.files.stateDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(f.files.metadata, "other", { mode: 0o600 });
        expect(() => plan.apply()).toThrow();
        expect(() => plan.rollback()).toThrow();
        expect(fs.existsSync(f.files.definition)).toBe(false);
        expect(fs.readFileSync(f.files.metadata, "utf8")).toBe("other");
    });
    it("候选写盘失败只清理本次临时文件，不留下假成功定义", () => {
        const f = fixture(),
            plan = prepareManagerServiceInstallation(f.spec, f.host);
        vi.spyOn(fs, "writeFileSync").mockImplementation(() => {
            throw new Error("disk-write");
        });
        expect(() => plan.apply()).toThrow("disk-write");
        expect(fs.readdirSync(path.dirname(f.files.definition))).toEqual([]);
        expect(fs.existsSync(f.files.metadata)).toBe(false);
        expect(plan.verify()).toBe(false);
    });
    it("第二文件发布失败保留首文件证据，由调用者显式回退自有候选", () => {
        const f = fixture(),
            plan = prepareManagerServiceInstallation(f.spec, f.host);
        const original = fs.linkSync;
        vi.spyOn(fs, "linkSync").mockImplementation((from, to) => {
            if (to === f.files.metadata) throw new Error("disk failure");
            original(from, to);
        });
        expect(() => plan.apply()).toThrow("disk failure");
        expect(fs.existsSync(f.files.definition)).toBe(true);
        expect(plan.verify()).toBe(false);
        plan.rollback();
        expect(fs.existsSync(f.files.definition)).toBe(false);
    });
    it("部分完成时外部替换任一候选，回退在删除前整体拒绝", () => {
        const f = fixture(),
            plan = prepareManagerServiceInstallation(f.spec, f.host);
        plan.apply();
        const original = fs.readFileSync(f.files.definition);
        fs.unlinkSync(f.files.definition);
        fs.writeFileSync(f.files.definition, original, { mode: 0o644 });
        expect(plan.verify()).toBe(false);
        expect(() => plan.rollback()).toThrow();
        expect(fs.existsSync(f.files.metadata)).toBe(true);
    });
    it("拒绝符号链接祖先、占位链接、开放状态目录与Windows", () => {
        const f = fixture();
        fs.symlinkSync(f.root, path.join(f.root, "Library"));
        expect(() => prepareManagerServiceInstallation(f.spec, f.host)).toThrow();
        fs.unlinkSync(path.join(f.root, "Library"));
        fs.mkdirSync(path.dirname(f.files.definition), { recursive: true, mode: 0o700 });
        fs.symlinkSync(path.join(f.root, "missing"), f.files.definition);
        expect(() => prepareManagerServiceInstallation(f.spec, f.host)).toThrow();
        const other = fixture();
        fs.mkdirSync(other.files.stateDir, { recursive: true, mode: 0o755 });
        expect(() => prepareManagerServiceInstallation(other.spec, other.host).apply()).toThrow();
        expect(() =>
            prepareManagerServiceInstallation(other.spec, { ...other.host, platform: "win32" }),
        ).toThrow();
    });
    it("OS重载后发现实际运行/未知静止时不得报告安装验收通过", async () => {
        const f = fixture(),
            plan = prepareManagerServiceInstallation(f.spec, f.host);
        plan.apply();
        const platform: ServicePlatform = {
            inspect: async () => ({
                state: "running",
                running: true,
                enabled: true,
                loaded: true,
                definitionPath: f.files.definition,
                processId: 42,
                identity: "unknown",
                quiescent: false,
            }),
            reload: async () => {},
            start: async () => {},
            quiesce: async () => {},
        };
        await expect(plan.reload(platform, true)).rejects.toThrow();
        expect(plan.verify()).toBe(true);
    });
});
