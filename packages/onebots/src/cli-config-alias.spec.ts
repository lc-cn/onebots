import { describe, expect, it, vi } from "vitest";

const runControlCommand = vi.hoisted(() => vi.fn(async () => true));
vi.mock("./control/command.js", () => ({ runControlCommand }));

import { runCli } from "./cli.js";

describe("CLI 配置入口", () => {
    it("将顶层 config 路由到统一控制命令", async () => {
        const argv = ["node", "onebots", "config", "validate", "--draft", "draft-id"];
        await runCli(argv);
        expect(runControlCommand).toHaveBeenCalledExactlyOnceWith(argv);
    });
});
