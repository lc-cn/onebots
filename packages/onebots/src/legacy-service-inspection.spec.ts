import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyServiceInspection } from "./legacy-service-inspection.js";
import { renderLaunchdPlist, renderSystemdUnit, type ServiceSpec } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";

const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));

function fixture(platform: "linux" | "darwin" = "linux") {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/onebots-legacy-inspection-"));
    roots.push(root);
    const host: ServiceHost = {
        platform,
        homedir: path.join(root, "home"),
        uid: 501,
        env: {},
        exec: vi.fn(() => "inactive\n"),
        spawn: vi.fn(async () => 0),
    };
    const spec: ServiceSpec = {
        scope: "user",
        configPath: path.join(root, "config.yaml"),
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        nodePath: "/opt/node",
        binPath: "/opt/onebots/bin.js",
        workingDirectory: root,
    };
    const files = getServiceFiles("user", host);
    fs.mkdirSync(path.dirname(files.definition), { recursive: true });
    fs.mkdirSync(files.stateDir, { recursive: true });
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    const definition =
        platform === "linux"
            ? renderSystemdUnit(spec)
            : renderLaunchdPlist(
                  spec,
                  path.join(files.stateDir, "onebots.log"),
                  path.join(files.stateDir, "onebots-error.log"),
              );
    fs.writeFileSync(files.definition, definition, { mode: 0o644 });
    return { host, spec, files, inspection: new LegacyServiceInspection("user", host) };
}

describe("legacy service read-only inspection", () => {
    it.each(["linux", "darwin"] as const)("validates an exact %s legacy definition", platform => {
        const test = fixture(platform);
        expect(test.inspection.readSpec()).toEqual(test.spec);
        expect(test.inspection.definitionPath(test.spec)).toBe(test.files.definition);
        expect(test.inspection.definitionIsCurrent(test.spec)).toBe(true);
        expect(test.host.exec).not.toHaveBeenCalled();
        expect(test.host.spawn).not.toHaveBeenCalled();
    });

    it("rejects control metadata, scope drift, definition drift and writable definitions", () => {
        const test = fixture();
        fs.writeFileSync(
            test.files.metadata,
            JSON.stringify({
                schemaVersion: 1,
                runtimeKind: "control",
                scope: "user",
                workspace: test.spec.workingDirectory,
                nodePath: test.spec.nodePath,
                binPath: test.spec.binPath,
                workingDirectory: test.spec.workingDirectory,
                host: "127.0.0.1",
                port: 6727,
            }),
            { mode: 0o600 },
        );
        expect(() => test.inspection.readSpec()).toThrow("旧服务元数据无效");

        fs.writeFileSync(test.files.metadata, JSON.stringify(test.spec), { mode: 0o600 });
        expect(test.inspection.definitionIsCurrent({ ...test.spec, scope: "system" })).toBe(false);
        fs.appendFileSync(test.files.definition, "\n# drift");
        expect(test.inspection.definitionIsCurrent(test.spec)).toBe(false);
        fs.writeFileSync(test.files.definition, renderSystemdUnit(test.spec), { mode: 0o666 });
        fs.chmodSync(test.files.definition, 0o666);
        expect(test.inspection.definitionIsCurrent(test.spec)).toBe(false);
    });

    it("has no lifecycle mutation methods", () => {
        const methods = Object.getOwnPropertyNames(LegacyServiceInspection.prototype);
        expect(methods).not.toEqual(
            expect.arrayContaining(["install", "start", "stop", "restart", "uninstall"]),
        );
    });
});

it.each([
    ["stderr", 'Could not find service "onebots"'],
    ["stdout", Buffer.from("service onebots not found")],
    ["message", "service not found"],
    ["message", "unknown service"],
    ["stderr", "no such process"],
])("classifies unloaded launchd from %s without exposing command output", (field, value) => {
    const test = fixture("darwin");
    const error = new Error("secret command details");
    Object.assign(error, { [field as string]: value });
    vi.mocked(test.host.exec).mockImplementation(() => {
        throw error;
    });
    expect(test.inspection.status()).toEqual({
        installed: true,
        running: false,
        scope: "user",
        detail: "launchd 任务未加载",
    });
});

it.each(["darwin", "linux"] as const)("redacts unknown %s status failures", platform => {
    const test = fixture(platform);
    const error = Object.assign(new Error("secret message"), {
        stderr: Buffer.from("secret stderr"),
        stdout: "secret stdout",
    });
    vi.mocked(test.host.exec).mockImplementation(() => {
        throw error;
    });
    expect(test.inspection.status()).toEqual({
        installed: true,
        running: false,
        scope: "user",
        detail: "旧服务状态无法确认",
        error: "进程管理器状态查询失败",
    });
});
