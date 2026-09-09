import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { runVerificationCommand } from "./verification-command.js";

function fixture() {
    const command = {
        operationId: randomUUID(),
        challengeId: randomUUID(),
        expected: { gatewayInstanceId: randomUUID(), configVersion: "a".repeat(64) },
        action: "submit" as const,
        data: { code: "private-code-123" },
    };
    const receipt = {
        id: command.operationId,
        challengeId: command.challengeId,
        ...command.expected,
        action: command.action,
        status: "unknown" as const,
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
    };
    const verification = {
        pending: vi.fn(async () => ({ ...command.expected, challenges: [] })),
        execute: vi.fn(async () => receipt),
        reconcile: vi.fn(),
        acknowledge: vi.fn(),
        operation: vi.fn(async () => receipt),
    };
    const output = vi.fn();
    const run = (args: string[], body = "", isTTY = false) =>
        runVerificationCommand(args, {
            createClient: () => ({ verification }),
            output,
            stdin: Object.assign(Readable.from([body]), { isTTY }),
        });
    return { command, receipt, verification, output, run };
}
it("CLI 只派发一次，unknown只输出回执并允许另次只读查询", async () => {
    const f = fixture();
    await f.run(["execute", "--stdin"], JSON.stringify(f.command));
    expect(f.verification.execute).toHaveBeenCalledOnce();
    expect(f.verification.execute).toHaveBeenCalledWith(f.command);
    expect(f.output).toHaveBeenCalledWith(JSON.stringify(f.receipt));
    expect(JSON.stringify(f.output.mock.calls)).not.toContain(f.command.data.code);
    await f.run(["operation", "--request", f.command.operationId]);
    expect(f.verification.operation).toHaveBeenCalledWith(f.command.operationId);
    expect(f.verification.execute).toHaveBeenCalledOnce();
});
it("丢失确认保留原ID提示，不暴露服务错误或答案且不重试", async () => {
    const f = fixture();
    f.verification.execute.mockRejectedValue(new Error(f.command.data.code));
    const error = await f
        .run(["execute", "--stdin"], JSON.stringify(f.command))
        .catch(error => error);
    expect(error.message).toContain(f.command.operationId);
    expect(error.message).not.toContain(f.command.data.code);
    expect(f.verification.execute).toHaveBeenCalledOnce();
    expect(f.output).not.toHaveBeenCalled();
});
it("禁止终端明文、超限正文、非法JSON及命令行验证码", async () => {
    const f = fixture();
    await expect(f.run(["execute", "--stdin"], JSON.stringify(f.command), true)).rejects.toThrow();
    await expect(f.run(["execute", "--stdin"], "x".repeat(131073))).rejects.toThrow();
    await expect(f.run(["execute", "--stdin"], '{"secret":"private')).rejects.toThrow();
    await expect(f.run(["execute", "--code", "secret"])).rejects.toThrow();
    await expect(f.run(["execute", "--stdin", "--stdin"])).rejects.toThrow();
    await expect(f.run(["operation", "--request", "../../secret"])).rejects.toThrow();
    expect(f.verification.execute).not.toHaveBeenCalled();
});

it("显式对账只传原 ID，失败不重发或执行验证", async () => {
    const f = fixture();
    f.verification.reconcile.mockResolvedValue(f.receipt);
    await f.run(["reconcile", "--request", f.receipt.id]);
    expect(f.verification.reconcile).toHaveBeenCalledExactlyOnceWith(f.receipt.id);
    expect(f.verification.execute).not.toHaveBeenCalled();
    f.verification.reconcile.mockRejectedValue(new Error("private"));
    await expect(f.run(["reconcile", "--request", f.receipt.id])).rejects.toThrow(f.receipt.id);
    expect(f.verification.reconcile).toHaveBeenCalledTimes(2);
    expect(f.verification.operation).not.toHaveBeenCalled();
});

it("接受未知结果必须有显式风险参数，丢失确认仅引导查询原 ID", async () => {
    const f = fixture();
    await expect(f.run(["acknowledge", "--request", f.receipt.id])).rejects.toThrow();
    expect(f.verification.acknowledge).not.toHaveBeenCalled();
    f.verification.acknowledge.mockResolvedValue({
        ...f.receipt,
        acknowledgement: { acceptedAt: new Date(2).toISOString() },
    });
    await f.run(["acknowledge", "--request", f.receipt.id, "--accept-unknown"]);
    expect(f.verification.acknowledge).toHaveBeenCalledExactlyOnceWith(f.receipt.id, true);
    f.verification.acknowledge.mockRejectedValue(new Error("private"));
    await expect(
        f.run(["acknowledge", "--request", f.receipt.id, "--accept-unknown"]),
    ).rejects.toThrow(f.receipt.id);
    expect(f.verification.acknowledge).toHaveBeenCalledTimes(2);
    expect(f.verification.execute).not.toHaveBeenCalled();
});
