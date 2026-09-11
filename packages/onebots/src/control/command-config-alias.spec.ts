import { beforeEach, describe, expect, it, vi } from "vitest";

const runConfigurationCommand = vi.hoisted(() => vi.fn(async () => {}));
vi.mock("./configuration-command.js", () => ({ runConfigurationCommand }));

import { runControlCommand } from "./command.js";

beforeEach(() => runConfigurationCommand.mockClear());

describe("配置命令公开别名", () => {
    it.each([
        ["顶层", ["node", "onebots", "config", "validate", "--draft", "draft-id"]],
        ["control", ["node", "onebots", "control", "config", "validate", "--draft", "draft-id"]],
    ])("%s入口复用同一配置客户端分发", async (_name, argv) => {
        expect(await runControlCommand(argv)).toBe(true);
        expect(runConfigurationCommand).toHaveBeenCalledExactlyOnceWith([
            "validate",
            "--draft",
            "draft-id",
        ]);
    });

    it("顶层 apply 原样交给同一配置客户端", async () => {
        const argv = ["node", "onebots", "config", "apply", "--receipt", "receipt-id"];
        expect(await runControlCommand(argv)).toBe(true);
        expect(runConfigurationCommand).toHaveBeenCalledExactlyOnceWith([
            "apply",
            "--receipt",
            "receipt-id",
        ]);
    });
});
