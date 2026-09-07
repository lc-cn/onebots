import { describe, expect, it, vi } from "vitest";
import { withCliOutput, writeCliOutput, writeCliError } from "./cli-output.js";
describe("工作台命令输出隔离", () => {
    it("并发操作只接收各自的异步消息，结束后恢复标准输出", async () => {
        const first: string[] = [],
            second: string[] = [];
        await Promise.all([
            withCliOutput(
                message => first.push(message),
                async () => {
                    await Promise.resolve();
                    writeCliOutput("first");
                },
            ),
            withCliOutput(
                message => second.push(message),
                async () => {
                    await Promise.resolve();
                    writeCliError("second");
                },
            ),
        ]);
        expect(first).toEqual(["first"]);
        expect(second).toEqual(["second"]);
        const write = vi.spyOn(process.stdout, "write").mockReturnValue(true);
        try {
            writeCliOutput("outside");
            expect(write).toHaveBeenCalledWith("outside\n");
        } finally {
            write.mockRestore();
        }
    });
});
