import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlVerificationService } from "./verification-service.js";
import type { GatewayVerificationReply } from "../gateway/verification-contracts.js";
import type { GatewayVerificationOperation } from "./gateway-verification-client.js";

const roots: string[] = [];
const services: ControlVerificationService[] = [];
afterEach(async () => {
    await Promise.allSettled(services.splice(0).map(service => service.close()));
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const directory = mkdtempSync(path.join(tmpdir(), "ob-control-verification-"));
    roots.push(directory);
    const context = { gatewayInstanceId: randomUUID(), configVersion: "config-1" };
    const owner = "a".repeat(64);
    const command = {
        operationId: randomUUID(),
        challengeId: randomUUID(),
        expected: context,
        action: "submit" as const,
        data: { code: "secret-123456" },
    };
    const base = {
        ...context,
        controlInstanceId: randomUUID(),
        requestId: randomUUID(),
        protocolVersion: 1 as const,
        type: "gateway.verification.result" as const,
    };
    const list: GatewayVerificationReply = {
        ...base,
        action: "list",
        outcome: "succeeded",
        challenges: [
            {
                id: command.challengeId,
                createdAt: Date.now(),
                expiresAt: Date.now() + 60000,
                request: {
                    platform: "mock",
                    account_id: "bot",
                    type: "sms",
                    hint: "输入验证码",
                    options: { blocks: [{ type: "input", key: "code" }] },
                },
            },
        ],
    };
    const forward = vi.fn(
        async (
            _context: typeof context,
            operation: GatewayVerificationOperation,
        ): Promise<GatewayVerificationReply> => {
            if (operation.action === "list") return list;
            const files = readdirSync(path.join(directory, "operations"));
            expect(files).toHaveLength(1);
            const disk = readFileSync(path.join(directory, "operations", files[0]), "utf8");
            expect(disk).toContain('"running"');
            expect(disk).not.toContain(command.data.code);
            return {
                ...base,
                action: "execute",
                operationId: operation.command.operationId,
                outcome: "succeeded",
            };
        },
    );
    const options = { directory, currentContext: () => context, forward, timeoutMs: 50 };
    const service = new ControlVerificationService(options);
    services.push(service);
    return { service, options, forward, list, command, owner, directory };
}
it("意图先落盘；并发同操作和重启后的重放均不重新调用SDK", async () => {
    const f = fixture();
    const first = f.service.execute(f.owner, f.command);
    expect(f.service.execute(f.owner, f.command)).toBe(first);
    expect(await first).toMatchObject({ id: f.command.operationId, status: "succeeded" });
    expect(
        f.forward.mock.calls.filter(([, operation]) => operation.action === "execute"),
    ).toHaveLength(1);
    await expect(f.service.execute("b".repeat(64), f.command)).rejects.toMatchObject({
        httpStatus: 404,
    });
    await expect(
        f.service.execute(f.owner, { ...f.command, data: { code: "different" } }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    await f.service.close();
    const recovered = new ControlVerificationService(f.options);
    services.push(recovered);
    expect(await recovered.execute(f.owner, f.command)).toMatchObject({ status: "succeeded" });
    expect(
        f.forward.mock.calls.filter(([, operation]) => operation.action === "execute"),
    ).toHaveLength(1);
    expect(JSON.stringify(recovered.operation(f.owner, f.command.operationId))).not.toMatch(
        /Hash|Digest|secret/,
    );
});
it("超时后只读核对原实例回执，追加确认而不重新提交验证码", async () => {
    const f = fixture();
    f.forward.mockImplementation(async (_context, operation) => {
        if (operation.action === "list") return f.list;
        if (operation.action === "execute") return new Promise(() => {});
        return {
            ...f.command.expected,
            type: "gateway.verification.result",
            protocolVersion: 1,
            controlInstanceId: randomUUID(),
            requestId: randomUUID(),
            action: "query",
            operationId: operation.operationId,
            challengeId: operation.challengeId,
            verificationAction: operation.verificationAction,
            outcome: "succeeded",
            state: "succeeded",
        };
    });
    expect(await f.service.execute(f.owner, f.command)).toMatchObject({ status: "unknown" });
    await expect(f.service.reconcile("b".repeat(64), f.command.operationId)).rejects.toMatchObject({
        httpStatus: 404,
    });
    const result = await f.service.reconcile(f.owner, f.command.operationId);
    expect(result).toMatchObject({ status: "unknown", resolution: { outcome: "succeeded" } });
    expect(await f.service.reconcile(f.owner, f.command.operationId)).toEqual(result);
    expect(f.forward.mock.calls.map(([, operation]) => operation.action)).toEqual([
        "list",
        "execute",
        "query",
    ]);
    expect(JSON.stringify(f.forward.mock.calls[2])).not.toContain(f.command.data.code);
});
it("原网关已切换时不询问新实例，也不解除未知结果", async () => {
    const f = fixture();
    f.forward.mockImplementation(async (_context, operation) =>
        operation.action === "list" ? f.list : new Promise(() => {}),
    );
    await f.service.execute(f.owner, f.command);
    f.options.currentContext = () => ({ gatewayInstanceId: randomUUID(), configVersion: "new" });
    expect(await f.service.reconcile(f.owner, f.command.operationId)).toMatchObject({
        status: "unknown",
    });
    expect(f.forward.mock.calls.map(([, operation]) => operation.action)).toEqual([
        "list",
        "execute",
    ]);
});
it.each(["missing", "running", "unknown"] as const)(
    "查询原回执为%s不解除保护或重派",
    async state => {
        const f = fixture();
        f.forward.mockImplementation(async (_context, operation) => {
            if (operation.action === "list") return f.list;
            if (operation.action === "execute") return new Promise(() => {});
            return {
                ...f.command.expected,
                type: "gateway.verification.result",
                protocolVersion: 1,
                controlInstanceId: randomUUID(),
                requestId: randomUUID(),
                ...operation,
                outcome: "succeeded",
                state,
            };
        });
        await f.service.execute(f.owner, f.command);
        const result = await f.service.reconcile(f.owner, f.command.operationId);
        expect(result.status).toBe("unknown");
        expect(result.resolution).toBeUndefined();
        await expect(
            f.service.execute(f.owner, { ...f.command, operationId: randomUUID() }),
        ).rejects.toMatchObject({ httpStatus: 409 });
        expect(
            f.forward.mock.calls.filter(([, operation]) => operation.action === "execute"),
        ).toHaveLength(1);
    },
);
it("查询期间设备撤销，不持久化迟到的确认结果", async () => {
    const f = fixture();
    let authorized = true;
    f.forward.mockImplementation(async (_context, operation) => {
        if (operation.action === "list") return f.list;
        if (operation.action === "execute") return new Promise(() => {});
        authorized = false;
        return {
            ...f.command.expected,
            type: "gateway.verification.result",
            protocolVersion: 1,
            controlInstanceId: randomUUID(),
            requestId: randomUUID(),
            ...operation,
            outcome: "succeeded",
            state: "succeeded",
        };
    });
    await f.service.execute(f.owner, f.command);
    await expect(
        f.service.reconcile(f.owner, f.command.operationId, () => authorized),
    ).rejects.toMatchObject({ httpStatus: 403 });
    expect(f.service.operation(f.owner, f.command.operationId).resolution).toBeUndefined();
});
it("超时保存unknown且禁止换操作ID再次提交；迟到成功不能覆盖回执", async () => {
    const f = fixture();
    const pending = Promise.withResolvers<GatewayVerificationReply>();
    f.forward.mockImplementation(async (_context, operation) =>
        operation.action === "list" ? f.list : pending.promise,
    );
    expect(await f.service.execute(f.owner, f.command)).toMatchObject({ status: "unknown" });
    await expect(
        f.service.execute(f.owner, { ...f.command, operationId: randomUUID() }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    pending.resolve({
        ...f.list,
        action: "execute",
        operationId: f.command.operationId,
        outcome: "succeeded",
    } as GatewayVerificationReply);
    await Promise.resolve();
    expect(f.service.operation(f.owner, f.command.operationId).status).toBe("unknown");
    expect(
        f.forward.mock.calls.filter(([, operation]) => operation.action === "execute"),
    ).toHaveLength(1);
    await f.service.close();
    const recovered = new ControlVerificationService(f.options);
    services.push(recovered);
    await expect(
        recovered.execute(f.owner, { ...f.command, operationId: randomUUID() }),
    ).rejects.toMatchObject({ httpStatus: 409 });
});
it("挑战查询期间设备撤权，不写入派发意图也不执行SDK", async () => {
    const f = fixture();
    let authorized = true;
    f.forward.mockImplementation(async () => {
        authorized = false;
        return f.list;
    });
    await expect(f.service.execute(f.owner, f.command, () => authorized)).rejects.toMatchObject({
        httpStatus: 403,
    });
    expect(readdirSync(path.join(f.directory, "operations"))).toEqual([]);
    expect(f.forward).toHaveBeenCalledOnce();
});
it("不同设备不能查看回执，本机只读恢复不会触发派发", async () => {
    const f = fixture();
    await f.service.execute(f.owner, f.command);
    expect(() => f.service.operation("b".repeat(64), f.command.operationId)).toThrow();
    expect(f.service.operation("b".repeat(64), f.command.operationId, true).status).toBe(
        "succeeded",
    );
    expect(f.forward).toHaveBeenCalledTimes(2);
});

it("挑战查询期间切换网关，不记录旧实例操作或派发验证码", async () => {
    const f = fixture();
    f.forward.mockImplementation(async () => {
        f.options.currentContext = () => ({
            gatewayInstanceId: randomUUID(),
            configVersion: "config-2",
        });
        return f.list;
    });
    await expect(f.service.execute(f.owner, f.command)).rejects.toMatchObject({ httpStatus: 503 });
    expect(readdirSync(path.join(f.directory, "operations"))).toEqual([]);
    expect(f.forward).toHaveBeenCalledOnce();
});

it("不同设备并发提交同一账号，只允许一个操作进入SDK", async () => {
    const f = fixture();
    const dispatched = Promise.withResolvers<void>();
    const result = Promise.withResolvers<GatewayVerificationReply>();
    f.forward.mockImplementation(async (_context, operation) => {
        if (operation.action === "list") return f.list;
        dispatched.resolve();
        return result.promise;
    });
    const first = f.service.execute(f.owner, f.command);
    await dispatched.promise;
    await expect(
        f.service.execute("b".repeat(64), {
            ...f.command,
            operationId: randomUUID(),
        }),
    ).rejects.toMatchObject({ httpStatus: 409 });
    result.resolve({
        type: "gateway.verification.result",
        protocolVersion: 1,
        controlInstanceId: randomUUID(),
        requestId: randomUUID(),
        ...f.command.expected,
        action: "execute",
        operationId: f.command.operationId,
        outcome: "succeeded",
    });
    expect(await first).toMatchObject({ status: "succeeded" });
    expect(
        f.forward.mock.calls.filter(([, operation]) => operation.action === "execute"),
    ).toHaveLength(1);
});
