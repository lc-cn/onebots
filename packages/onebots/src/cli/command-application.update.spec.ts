import { describe, expect, it } from "vitest";
import { updateCommandResult } from "./command-application.js";

describe("update command result", () => {
    it("无需更新时保持成功退出", () => {
        expect(updateCommandResult({ status: "current", changes: [] })).toEqual({});
    });

    it("发现已验证更新时返回独立退出码和稳定汇总", () => {
        expect(
            updateCommandResult({
                status: "updates_available",
                changes: [
                    { name: "onebots", current: "1.2.0", target: "1.3.0" },
                    {
                        name: "@onebots/adapter-mock",
                        current: "1.2.1",
                        target: "1.2.2",
                    },
                ],
            }),
        ).toEqual({
            output: "发现 2 个可用更新（已通过目标版本目录校验）",
            exitCode: 2,
        });
    });

    it.each(["updated", "cancelled"] as const)("%s 不改变执行更新的退出语义", status => {
        expect(
            updateCommandResult({
                status,
                changes: [{ name: "onebots", current: "1.2.0", target: "1.3.0" }],
            }),
        ).toEqual({});
    });
});
