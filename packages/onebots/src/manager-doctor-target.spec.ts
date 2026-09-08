import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveManagerDoctorTarget } from "./manager-doctor-target.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-doctor-target-")));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        uid: process.getuid?.(),
        homedir: root,
        env: {},
        exec: () => {
            throw new Error("no exec");
        },
        spawn: async () => {
            throw new Error("no spawn");
        },
    };
    const files = getServiceFiles("user", host);
    const spec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: root,
        workingDirectory: root,
        nodePath: process.execPath,
        binPath: path.join(root, "bin.js"),
        host: "127.0.0.1",
        port: 6727,
    };
    function metadata(value: unknown) {
        fs.mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
        fs.writeFileSync(files.metadata, JSON.stringify(value), { mode: 0o600 });
    }
    return { root, host, files, spec, metadata };
}
describe("doctor 现有目标解析", () => {
    it("显式目录不依赖服务元数据或 YAML，不创建任何内容", () => {
        const f = fixture();
        fs.writeFileSync(path.join(f.root, "config.yaml"), "broken: [");
        const before = fs.readdirSync(f.root);
        expect(resolveManagerDoctorTarget({ dataDir: `${f.root}/.` }, f.host)).toEqual({
            kind: "foreground",
            workspace: f.root,
            scope: "user",
        });
        expect(fs.readdirSync(f.root)).toEqual(before);
        expect(fs.existsSync(f.files.stateDir)).toBe(false);
    });
    it("严格服务元数据给出目标，坏 YAML 无关", () => {
        const f = fixture();
        f.metadata(f.spec);
        fs.writeFileSync(path.join(f.root, "config.yaml"), "broken: [");
        expect(resolveManagerDoctorTarget({}, f.host)).toEqual({
            kind: "service",
            workspace: f.root,
            scope: "user",
            spec: f.spec,
        });
    });
    it.each(["missing", "invalid", "legacy", "scope"])("%s 不猜工作区", kind => {
        const f = fixture();
        if (kind === "invalid") f.metadata({ syntheticSecret: "hidden" });
        if (kind === "scope") f.metadata({ ...f.spec, scope: "system" });
        if (kind === "legacy")
            f.metadata({
                scope: "user",
                configPath: "/private/old.yaml",
                adapters: [],
                protocols: [],
                nodePath: process.execPath,
                binPath: f.spec.binPath,
                workingDirectory: f.root,
            });
        const result = resolveManagerDoctorTarget({}, f.host);
        expect(result.kind).toBe("unavailable");
        expect(result).not.toHaveProperty("workspace");
        expect(JSON.stringify(result)).not.toContain("hidden");
        if (kind === "legacy") expect(JSON.stringify(result)).toContain("onebots migrate");
    });
    it("缺失目录、普通文件、祖先链接均拒绝且不创建目录", () => {
        const f = fixture();
        const missing = path.join(f.root, "missing");
        expect(resolveManagerDoctorTarget({ dataDir: missing }, f.host).kind).toBe("unavailable");
        expect(fs.existsSync(missing)).toBe(false);
        fs.writeFileSync(missing, "file");
        expect(resolveManagerDoctorTarget({ dataDir: missing }, f.host).kind).toBe("unavailable");
        const linked = path.join(f.root, "link");
        fs.symlinkSync(f.root, linked);
        expect(resolveManagerDoctorTarget({ dataDir: linked }, f.host).kind).toBe("unavailable");
    });
});
