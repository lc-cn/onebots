import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import * as path from "node:path";
import { prepareCliInvocation } from "./cli-invocation.js";
import { normalizeRuntimeOptions } from "./cli/command-application.js";

describe("OneBots CLI v2", () => {
    it("accepts runtime options before a flat Pastel route", () => {
        expect(prepareCliInvocation([
            "node", "onebots", "-r", "qq", "-c", "配置 文件.yaml", "install", "--system", "-p", "onebot-v11",
        ])).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "install", "--system", "-r", "qq", "-c", "配置 文件.yaml", "-p", "onebot-v11"],
        });
    });

    it("keeps the bare foreground invocation as the default route", () => {
        const argv = ["node", "onebots", "-r", "qq", "-p", "onebot-v11", "-c", "config.yaml"];
        expect(prepareCliInvocation(argv)).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "run", "-r", "qq", "-p", "onebot-v11", "-c", "config.yaml"],
        });
    });

    it("separates the non-interactive system-service runtime", () => {
        expect(prepareCliInvocation([
            "node", "onebots", "--service-runtime", "run", "-c", "config.yaml",
        ])).toEqual({
            kind: "service-runtime",
            argv: ["node", "onebots", "run", "-c", "config.yaml"],
        });
    });

    it("rejects removed command namespaces before Pastel renders a route", () => {
        expect(prepareCliInvocation(["node", "onebots", "gateway"])).toEqual({
            kind: "unknown",
            command: "gateway",
        });
    });

    it("moves shared options to the concrete config subroute", () => {
        expect(prepareCliInvocation([
            "node", "onebots", "-c", "config.yaml", "config", "get", "port",
        ])).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "config", "get", "port", "-c", "config.yaml"],
        });
        expect(prepareCliInvocation([
            "node", "onebots", "config", "get", "-r", "qq", "port",
        ])).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "config", "get", "port", "-r", "qq"],
        });
    });

    it("keeps repeatable runtime options from consuming send arguments", () => {
        expect(prepareCliInvocation([
            "node", "onebots", "send", "-r", "qq", "user-1", "hello", "--target_type", "private", "--channel", "qq.bot",
        ])).toEqual({
            kind: "cli",
            argv: ["node", "onebots", "send", "user-1", "hello", "--target_type", "private", "--channel", "qq.bot", "-r", "qq"],
        });
    });

    it("rejects runtime flags without a value", () => {
        expect(prepareCliInvocation(["node", "onebots", "run", "-c"])).toEqual({
            kind: "invalid",
            message: "-c 缺少参数",
        });
    });

    it("can load the built core package in a plain Node process", () => {
        expect(() => execFileSync(process.execPath, [
            "--input-type=module",
            "-e",
            "await import('@onebots/core'); process.exit(0)",
        ], {
            cwd: path.resolve("packages/onebots"),
            stdio: "pipe",
        })).not.toThrow();
    });

    it("loads repeated adapters and protocols only once", () => {
        expect(normalizeRuntimeOptions({
            config: "config.yaml",
            register: ["kook", "qq", "kook"],
            protocol: ["onebot-v11", "onebot-v11"],
        })).toMatchObject({
            adapters: ["kook", "qq"],
            protocols: ["onebot-v11"],
        });
    });
});
