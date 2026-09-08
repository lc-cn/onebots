import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { managerServiceLogsCommand } from "./manager-service-logs-command.js";
import { getServiceFiles } from "../service-files.js";
import { renderInstalledManagerService } from "../manager-service-definition.js";
import type { ServiceHost } from "../service-host.js";
import type { ManagerServiceSpec } from "../manager-service-spec.js";
vi.mock("../service-manager.js", () => {
    throw new Error("禁止旧日志实现");
});
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(platform: "linux" | "darwin" = "linux") {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-logs-")));
    roots.push(root);
    const host: ServiceHost = {
        platform,
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: vi.fn(() => "log lines"),
        spawn: vi.fn(async () => 0),
    };
    const files = getServiceFiles("user", host);
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: path.join(root, "never-created"),
        nodePath: process.execPath,
        binPath: path.join(root, "bin.js"),
        workingDirectory: root,
        host: "127.0.0.1",
        port: 6727,
    };
    fs.mkdirSync(files.stateDir, { recursive: true, mode: 0o700 });
    fs.mkdirSync(path.dirname(files.definition), { recursive: true, mode: 0o700 });
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    fs.writeFileSync(
        files.definition,
        renderInstalledManagerService(spec, platform, files.stateDir),
        { mode: 0o600 },
    );
    return { root, host, files, spec };
}
describe("新管理服务 logs CLI", () => {
    it.each([false, true])(
        "Linux 固定 journalctl 服务，无 workspace 创建，follow=%s",
        async follow => {
            const f = fixture();
            expect(
                await managerServiceLogsCommand({ system: false, follow, lines: 42 }, f.host),
            ).toEqual(follow ? { exitCode: 0 } : { exitCode: 0, output: "log lines" });
            const args = [
                "--user",
                "--no-pager",
                "-u",
                "onebots-gateway.service",
                "-n",
                "42",
                ...(follow ? ["-f"] : []),
            ];
            if (follow) {
                expect(f.host.spawn).toHaveBeenCalledExactlyOnceWith("journalctl", args);
                expect(f.host.exec).not.toHaveBeenCalled();
            } else {
                expect(f.host.exec).toHaveBeenCalledExactlyOnceWith("journalctl", args, {
                    timeoutMs: 5000,
                });
                expect(f.host.spawn).not.toHaveBeenCalled();
            }
            expect(fs.existsSync(f.spec.workspace)).toBe(false);
        },
    );
    it.each([false, true])("Darwin 只读取两个固定日志，follow=%s", async follow => {
        const f = fixture("darwin");
        const logs = ["onebots.log", "onebots-error.log"].map(name =>
            path.join(f.files.stateDir, name),
        );
        for (const log of logs) fs.writeFileSync(log, "logs", { mode: 0o600 });
        fs.writeFileSync(path.join(f.files.stateDir, "unrelated.log"), "synthetic-secret");
        const result = await managerServiceLogsCommand({ system: false, follow }, f.host);
        expect(result.exitCode).toBe(0);
        const args = ["-n", "100", ...(follow ? ["-f"] : []), ...logs];
        if (follow) expect(f.host.spawn).toHaveBeenCalledExactlyOnceWith("/usr/bin/tail", args);
        else
            expect(f.host.exec).toHaveBeenCalledExactlyOnceWith("/usr/bin/tail", args, {
                timeoutMs: 5000,
            });
        expect(fs.existsSync(f.spec.workspace)).toBe(false);
    });
    it.each([0, -1, 1.5, 10001, NaN, Infinity])("行数 %s 不启动日志程序", async lines => {
        const f = fixture();
        expect((await managerServiceLogsCommand({ system: false, lines }, f.host)).exitCode).toBe(
            1,
        );
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
    });
    it("拒绝运行时非布尔 follow 参数", async () => {
        const f = fixture(),
            options = { system: false, follow: false };
        Reflect.set(options, "follow", "true");
        expect((await managerServiceLogsCommand(options, f.host)).exitCode).toBe(1);
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
    });
    it.each([1, 10000])("接受行数边界 %s", async lines => {
        const f = fixture();
        expect((await managerServiceLogsCommand({ system: false, lines }, f.host)).exitCode).toBe(
            0,
        );
    });
    it.each(["legacy", "missing", "invalid", "scope", "definition"])(
        "%s fail closed",
        async kind => {
            const f = fixture();
            if (kind === "missing") fs.unlinkSync(f.files.metadata);
            if (kind === "invalid") fs.writeFileSync(f.files.metadata, "synthetic-secret");
            if (kind === "scope")
                fs.writeFileSync(f.files.metadata, JSON.stringify({ ...f.spec, scope: "system" }));
            if (kind === "definition") fs.writeFileSync(f.files.definition, "synthetic-secret");
            if (kind === "legacy")
                fs.writeFileSync(
                    f.files.metadata,
                    JSON.stringify({
                        scope: "user",
                        configPath: "/private/config.yaml",
                        adapters: [],
                        protocols: [],
                        nodePath: process.execPath,
                        binPath: f.spec.binPath,
                        workingDirectory: f.root,
                    }),
                );
            const result = await managerServiceLogsCommand({ system: false }, f.host);
            expect(result.exitCode).toBe(1);
            expect(result.output).not.toContain("synthetic-secret");
            if (kind === "legacy") expect(result.output).toContain("onebots migrate");
            expect(f.host.exec).not.toHaveBeenCalled();
            expect(f.host.spawn).not.toHaveBeenCalled();
        },
    );
    it("Darwin 无日志不猜其他文件、链接日志拒绝", async () => {
        const f = fixture("darwin");
        fs.writeFileSync(path.join(f.files.stateDir, "other.log"), "synthetic-secret");
        expect((await managerServiceLogsCommand({ system: false }, f.host)).output).toBe(
            "暂无管理服务日志。",
        );
        fs.symlinkSync(
            path.join(f.files.stateDir, "other.log"),
            path.join(f.files.stateDir, "onebots.log"),
        );
        expect((await managerServiceLogsCommand({ system: false }, f.host)).exitCode).toBe(1);
        expect(f.host.exec).not.toHaveBeenCalled();
        expect(f.host.spawn).not.toHaveBeenCalled();
    });
    it("follow 失败不回显子进程异常", async () => {
        const f = fixture();
        vi.mocked(f.host.spawn).mockRejectedValue(new Error("synthetic-secret"));
        const result = await managerServiceLogsCommand({ system: false, follow: true }, f.host);
        expect(result.exitCode).toBe(1);
        expect(result.output).not.toContain("synthetic-secret");
    });
});
