import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    captureManagerServiceRemoval,
    validRemovedAnchorLinkCount,
    type ManagerServiceRemoval,
} from "./manager-service-removal.js";
import { prepareManagerServiceInstallation } from "./manager-service-installation.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
const roots: string[] = [];
const plans: ManagerServiceRemoval[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const plan of plans.splice(0)) plan.dispose();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(platform: "linux" | "darwin" = "linux") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-removal-")));
    roots.push(root);
    const host: ServiceHost = {
        platform,
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: vi.fn(() => {
            throw new Error("no OS");
        }),
        spawn: vi.fn(async () => {
            throw new Error("no spawn");
        }),
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
    fs.mkdirSync(spec.workspace);
    fs.writeFileSync(path.join(spec.workspace, "config.yaml"), "broken: [");
    const installation = prepareManagerServiceInstallation(spec, host);
    try {
        installation.apply();
    } finally {
        installation.dispose();
    }
    const files = getServiceFiles("user", host);
    return {
        root,
        host,
        spec,
        files,
        capture() {
            const plan = captureManagerServiceRemoval(spec, host);
            plans.push(plan);
            return plan;
        },
    };
}
describe("管理服务卸载文件端口", () => {
    it("按 POSIX 和 Windows 删除待决语义校验锚点链接数", () => {
        expect(validRemovedAnchorLinkCount("linux", 0n)).toBe(true);
        expect(validRemovedAnchorLinkCount("linux", 1n)).toBe(false);
        expect(validRemovedAnchorLinkCount("win32", 0n)).toBe(true);
        expect(validRemovedAnchorLinkCount("win32", 1n)).toBe(true);
        expect(validRemovedAnchorLinkCount("win32", 2n)).toBe(false);
    });
    it.each(["linux", "darwin"] as const)("%s 按阶段删除且保留业务目录", platform => {
        const f = fixture(platform),
            plan = f.capture();
        expect(plan.verifyRemaining()).toBe(true);
        expect(() => plan.removeMetadata()).toThrow();
        expect(plan.snapshot.definition.path).toBe(f.files.definition);
        expect(plan.snapshot.metadata.sha256).toMatch(/^[a-f0-9]{64}$/);
        expect(plan.snapshot.definition.ino).toMatch(/^\d+$/);
        expect(plan.snapshot.definition.mtimeNs).toMatch(/^\d+$/);
        plan.removeDefinition();
        expect(plan.verifyRemaining()).toBe(true);
        expect(fs.existsSync(f.files.metadata)).toBe(true);
        plan.removeMetadata();
        expect(plan.verifyRemaining()).toBe(true);
        expect(fs.existsSync(f.files.metadata)).toBe(false);
        expect(fs.readFileSync(path.join(f.spec.workspace, "config.yaml"), "utf8")).toBe(
            "broken: [",
        );
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
    });
    it.each(["definition", "metadata"] as const)("同字节替换 %s 拒绝删除任何文件", key => {
        const f = fixture(),
            plan = f.capture();
        const bytes = fs.readFileSync(f.files[key]),
            mode = fs.statSync(f.files[key]).mode & 0o777;
        fs.unlinkSync(f.files[key]);
        fs.writeFileSync(f.files[key], bytes, { mode });
        expect(plan.verifyRemaining()).toBe(false);
        expect(() => plan.removeDefinition()).toThrow();
        expect(fs.existsSync(f.files.metadata)).toBe(true);
        expect(fs.existsSync(f.files.definition)).toBe(true);
    });
    it("阶段间定义重新出现会拒绝删除元数据", () => {
        const f = fixture(),
            plan = f.capture();
        plan.removeDefinition();
        fs.writeFileSync(f.files.definition, "foreign");
        expect(() => plan.removeMetadata()).toThrow();
        expect(fs.existsSync(f.files.metadata)).toBe(true);
    });
    it("删除后 fsync 失败保留未知状态，不能重试或删除下一文件", () => {
        const f = fixture(),
            plan = f.capture();
        vi.spyOn(fs, "fsyncSync").mockImplementation(() => {
            throw new Error("disk");
        });
        expect(() => plan.removeDefinition()).toThrow();
        expect(plan.verifyRemaining()).toBe(false);
        expect(() => plan.removeDefinition()).toThrow();
        expect(() => plan.removeMetadata()).toThrow();
        expect(fs.existsSync(f.files.metadata)).toBe(true);
    });
    it.each(["symlink", "mode", "hardlink", "metadata", "definition"])("捕获拒绝 %s", problem => {
        const f = fixture();
        if (problem === "symlink") {
            fs.unlinkSync(f.files.definition);
            fs.symlinkSync(f.files.metadata, f.files.definition);
        }
        if (problem === "mode") fs.chmodSync(f.files.metadata, 0o644);
        if (problem === "hardlink") fs.linkSync(f.files.metadata, path.join(f.root, "link"));
        if (problem === "metadata")
            fs.writeFileSync(f.files.metadata, JSON.stringify({ ...f.spec, port: 6728 }));
        if (problem === "definition") fs.appendFileSync(f.files.definition, "changed");
        expect(() => f.capture()).toThrow();
        expect(() =>
            captureManagerServiceRemoval(f.spec, { ...f.host, platform: "win32" }),
        ).toThrow();
    });
    it("dispose 全部释放且 close 已完成后报错不重复关闭", () => {
        const f = fixture(),
            plan = f.capture();
        const close = fs.closeSync,
            descriptors: number[] = [];
        vi.spyOn(fs, "closeSync").mockImplementation(fd => {
            descriptors.push(fd);
            close(fd);
            if (descriptors.length === 1) throw new Error("unknown close");
        });
        expect(() => plan.dispose()).toThrow();
        plan.dispose();
        expect(descriptors).toHaveLength(2);
        for (const fd of descriptors) expect(() => fs.fstatSync(fd)).toThrow();
        expect(plan.verifyRemaining()).toBe(false);
        expect(() => plan.removeDefinition()).toThrow();
        expect(fs.existsSync(f.files.definition)).toBe(true);
    });
});
