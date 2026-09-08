import { describe, expect, it, vi } from "vitest";
import { parseManagerSendOptions, runManagerSend, type ManagerSendClient } from "./manager-send.js";
const id = "11111111-1111-4111-8111-111111111111";
const context = {
    gatewayInstanceId: "22222222-2222-4222-8222-222222222222",
    configVersion: "a".repeat(64),
};
function fixture(status: "running" | "succeeded" | "rejected" | "unknown" = "succeeded") {
    const operation = {
        ...context,
        id,
        status,
        startedAt: "2026-09-08T00:00:00.000Z",
        ...(status === "running" ? {} : { finishedAt: "2026-09-08T00:00:01.000Z" }),
        ...(status === "succeeded" ? { messageId: "mock-result" } : {}),
    };
    const client: ManagerSendClient = {
        sendContext: vi.fn(async () => context),
        sendMessage: vi.fn(async () => operation),
        sendOperation: vi.fn(async () => operation),
    };
    const stdout = vi.fn(),
        stderr = vi.fn(),
        uuid = vi.fn(() => id),
        create = vi.fn(() => client);
    return {
        client,
        stdout,
        stderr,
        uuid,
        create,
        dependencies: { client: create, stdout, stderr, uuid },
    };
}
const flags = [
    "--data-dir",
    "/data",
    "--account",
    "mock/id.with/slash",
    "--target-type",
    "private",
];
describe("manager send CLI", () => {
    it("canonicalizes operation UUIDs before using filesystem-backed identities", () => {
        const upper = "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA";
        expect(parseManagerSendOptions(["--operation-id", upper])?.operationId).toBe(upper.toLowerCase());
    });
    it("does not report malformed or mismatched receipts as successful", async () => {
        for (const response of [
            { id, status: "succeeded" },
            {
                ...context,
                gatewayInstanceId: id,
                id,
                status: "succeeded",
                startedAt: "2026-09-08T00:00:00.000Z",
                finishedAt: "2026-09-08T00:00:01.000Z",
                messageId: "wrong-instance",
            },
        ]) {
            const f = fixture();
            Object.assign(f.client, { sendMessage: vi.fn(async () => response) });
            expect(await runManagerSend([...flags, "target", "hello"], f.dependencies)).toBe(1);
            expect(f.client.sendMessage).toHaveBeenCalledTimes(1);
        }
    });
    it("默认数字形ID保留字符串和前导零，消息不变", async () => {
        const f = fixture();
        expect(await runManagerSend([...flags, "00123", "synthetic-secret"], f.dependencies)).toBe(
            0,
        );
        expect(f.client.sendMessage).toHaveBeenCalledExactlyOnceWith({
            id,
            expected: context,
            account: "mock/id.with/slash",
            targetType: "private",
            targetId: "00123",
            message: "synthetic-secret",
        });
        expect(JSON.stringify([...f.stdout.mock.calls, ...f.stderr.mock.calls])).not.toContain(
            "synthetic-secret",
        );
    });
    it("显式number只接受非负安全整数", async () => {
        const f = fixture();
        await runManagerSend(
            [...flags, "--target-id-type", "number", "123", "hello"],
            f.dependencies,
        );
        expect(f.client.sendMessage).toHaveBeenCalledWith(
            expect.objectContaining({ targetId: 123 }),
        );
        for (const value of ["9007199254740992", "1.2", "-1", "1e3"])
            expect(() =>
                parseManagerSendOptions([
                    ...flags,
                    "--target-id-type",
                    "number",
                    "--",
                    value,
                    "hello",
                ]),
            ).toThrow();
    });
    it.each(["running", "unknown", "rejected"] as const)("%s不称成功，不重试", async status => {
        const f = fixture(status);
        expect(await runManagerSend([...flags, "target", "hello"], f.dependencies)).toBe(1);
        expect(f.client.sendMessage).toHaveBeenCalledTimes(1);
        expect(f.client.sendContext).toHaveBeenCalledTimes(1);
        expect(f.client.sendOperation).not.toHaveBeenCalled();
        expect(f.stdout).not.toHaveBeenCalled();
    });
    it("查询仅使用原ID，不创建操作或获取新上下文", async () => {
        const f = fixture();
        await runManagerSend(["--data-dir", "/data", "--operation-id", id], f.dependencies);
        expect(f.client.sendOperation).toHaveBeenCalledExactlyOnceWith(id);
        expect(f.uuid).not.toHaveBeenCalled();
        expect(f.client.sendContext).not.toHaveBeenCalled();
        expect(f.client.sendMessage).not.toHaveBeenCalled();
    });
    it("网络未知返回单一JSON并提供操作ID，不泄漏原始错误", async () => {
        const f = fixture();
        vi.mocked(f.client.sendMessage).mockRejectedValue(new Error("synthetic-secret"));
        expect(await runManagerSend([...flags, "--json", "target", "body"], f.dependencies)).toBe(
            1,
        );
        expect(f.stdout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(f.stdout.mock.calls[0][0])).toMatchObject({
            operationId: id,
            status: "unknown",
        });
        expect(JSON.stringify([...f.stdout.mock.calls, ...f.stderr.mock.calls])).not.toContain(
            "synthetic-secret",
        );
        expect(f.client.sendMessage).toHaveBeenCalledTimes(1);
        expect(f.uuid).toHaveBeenCalledTimes(1);
    });
    it.each(["--config", "-r", "-p", "--url", "--channel"])(
        "旧%s固定拒绝，不创建client",
        async flag => {
            const f = fixture();
            expect(await runManagerSend([flag, "secret"], f.dependencies)).toBe(1);
            expect(f.create).not.toHaveBeenCalled();
            expect(f.uuid).not.toHaveBeenCalled();
            expect(f.stderr.mock.calls[0][0]).toContain("旧 --config/-r/-p/--url/--channel 已停用");
            expect(f.stderr.mock.calls[0][0]).not.toContain("secret");
        },
    );
    it("help及错误JSON不调用client", async () => {
        const f = fixture();
        expect(await runManagerSend(["--help"], f.dependencies)).toBe(0);
        expect(f.create).not.toHaveBeenCalled();
        f.stdout.mockClear();
        expect(await runManagerSend(["--json", "--url", "private"], f.dependencies)).toBe(1);
        expect(f.stdout).toHaveBeenCalledTimes(1);
        expect(JSON.parse(f.stdout.mock.calls[0][0]).status).toBe("rejected");
    });
});
