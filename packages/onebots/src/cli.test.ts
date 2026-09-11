import { afterEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { prepareCliInvocation } from "./cli-invocation.js";
import {
    normalizeRuntimeOptions,
    resolveConfiguredRuntimeOptions,
} from "./cli/command-application.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("OneBots CLI v2", () => {
    it("交互式默认工作台，显式 run 与无 TTY 启动保持前台语义", () => {
        expect(prepareCliInvocation(["node", "onebots"], true)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "ui"],
        });
        expect(prepareCliInvocation(["node", "onebots", "run"], true)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "run"],
        });
        expect(prepareCliInvocation(["node", "onebots"], false)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "run"],
        });
        expect(prepareCliInvocation(["node", "onebots", "--help"], true)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "--help"],
        });
    });
    it("accepts runtime options before a flat Pastel route", () => {
        expect(
            prepareCliInvocation([
                "node",
                "onebots",
                "-r",
                "qq",
                "-c",
                "配置 文件.yaml",
                "install",
                "--system",
                "-p",
                "onebot-v11",
            ]),
        ).toEqual({
            kind: "cli",
            argv: [
                "node",
                "onebots",
                "install",
                "--system",
                "-r",
                "qq",
                "-c",
                "配置 文件.yaml",
                "-p",
                "onebot-v11",
            ],
        });
    });

    it("keeps the bare foreground invocation as the default route", () => {
        const argv = [
            "node",
            "onebots",
            "-r",
            "qq",
            "-p",
            "onebot-v11",
            "-t",
            "zhin",
            "-c",
            "config.yaml",
        ];
        expect(prepareCliInvocation(argv)).toEqual({
            kind: "cli",
            argv: [
                "node",
                "onebots",
                "run",
                "-r",
                "qq",
                "-p",
                "onebot-v11",
                "-t",
                "zhin",
                "-c",
                "config.yaml",
            ],
        });
    });

    it("rejects the removed non-interactive system-service runtime", () => {
        expect(
            prepareCliInvocation([
                "node",
                "onebots",
                "--service-runtime",
                "run",
                "-c",
                "config.yaml",
            ]),
        ).toEqual({
            kind: "invalid",
            message: "--service-runtime 已移除；旧服务请先执行 onebots migrate",
        });
    });

    it.each(["gateway", "service", "daemon", "config"])(
        "rejects removed command namespace %s before Pastel renders a route",
        command => {
            expect(prepareCliInvocation(["node", "onebots", command])).toEqual({
                kind: "unknown",
                command,
            });
        },
    );

    it("rejects help for the removed config command instead of exposing legacy routes", () => {
        expect(prepareCliInvocation(["node", "onebots", "config", "--help"])).toEqual({
            kind: "unknown",
            command: "config",
        });
    });

    it("keeps repeatable runtime options from consuming send arguments", () => {
        expect(
            prepareCliInvocation([
                "node",
                "onebots",
                "send",
                "-r",
                "qq",
                "user-1",
                "hello",
                "--target_type",
                "private",
                "--channel",
                "qq.bot",
            ]),
        ).toEqual({
            kind: "cli",
            argv: [
                "node",
                "onebots",
                "send",
                "user-1",
                "hello",
                "--target_type",
                "private",
                "--channel",
                "qq.bot",
                "-r",
                "qq",
            ],
        });
    });

    it("rejects runtime flags without a value", () => {
        expect(prepareCliInvocation(["node", "onebots", "run", "-c"])).toEqual({
            kind: "invalid",
            message: "-c 缺少参数",
        });
    });

    it("can load the built core package in a plain Node process", () => {
        expect(() =>
            execFileSync(
                process.execPath,
                ["--input-type=module", "-e", "await import('@onebots/core'); process.exit(0)"],
                {
                    cwd: path.resolve("packages/onebots"),
                    stdio: "pipe",
                },
            ),
        ).not.toThrow();
    });

    it("loads repeated adapters and protocols only once", () => {
        expect(
            normalizeRuntimeOptions({
                config: "config.yaml",
                register: ["kook", "qq", "kook"],
                protocol: ["onebot-v11", "onebot-v11"],
                target: ["zhin", "zhin"],
            }),
        ).toMatchObject({
            adapters: ["kook", "qq"],
            protocols: ["onebot-v11"],
            applications: ["zhin"],
        });
    });

    it("uses persisted plugin defaults while keeping explicit category overrides", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-cli-plugins-"));
        temporaryDirectories.push(directory);
        const config = path.join(directory, "config.yaml");
        fs.writeFileSync(
            config,
            "plugins:\n  adapters: [mock]\n  protocols: [onebot-v11]\n  applications: [zhin]\n",
        );

        expect(
            resolveConfiguredRuntimeOptions({ config, register: [], protocol: [] }),
        ).toMatchObject({
            adapters: ["mock"],
            protocols: ["onebot-v11"],
            applications: ["zhin"],
        });
        expect(
            resolveConfiguredRuntimeOptions({ config, register: ["qq"], protocol: [] }),
        ).toMatchObject({ adapters: ["qq"], protocols: ["onebot-v11"] });
    });
});
