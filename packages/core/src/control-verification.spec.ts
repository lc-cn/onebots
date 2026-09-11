import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
    ControlClient,
    controlVerificationOutcome,
    isControlVerificationCommand,
    isControlVerificationOperation,
    isControlVerificationSnapshot,
    type ControlVerificationCommand,
    type ControlVerificationOperation,
    type ControlTransport,
} from "./control.js";

const command = (): ControlVerificationCommand => ({
    operationId: randomUUID(),
    challengeId: randomUUID(),
    expected: { gatewayInstanceId: randomUUID(), configVersion: "config-v1" },
    action: "submit",
    data: { code: "123456" },
});
const receipt = (input: ControlVerificationCommand): ControlVerificationOperation => ({
    id: input.operationId,
    challengeId: input.challengeId,
    ...input.expected,
    action: input.action,
    status: "succeeded",
    startedAt: "2026-09-09T00:00:00.000Z",
    finishedAt: "2026-09-09T00:00:01.000Z",
});
const snapshot = () => ({
    gatewayInstanceId: randomUUID(),
    configVersion: "v1",
    challenges: [
        {
            id: randomUUID(),
            createdAt: 0,
            expiresAt: 1800000,
            request: {
                platform: "mock",
                account_id: "00123",
                type: "pair_code",
                hint: "请输入验证码",
                options: { blocks: [{ type: "input", key: "code", secret: true, maxLength: 6 }] },
            },
        },
    ],
});

describe("shared account verification client", () => {
    it("uses the common HTTP paths and preserves challenge identity", async () => {
        const input = command();
        const result = receipt(input);
        const pending = snapshot();
        const request = vi
            .fn<ControlTransport["request"]>()
            .mockResolvedValueOnce(pending)
            .mockResolvedValueOnce(result)
            .mockResolvedValueOnce(result);
        const client = new ControlClient({ request });
        expect(await client.verification.pending()).toEqual(pending);
        expect(await client.verification.execute(input)).toEqual(result);
        expect(await client.verification.operation(input.operationId)).toEqual(result);
        expect(request.mock.calls).toEqual([
            ["GET", "/api/control/verification/pending"],
            ["POST", "/api/control/verification/execute", input],
            ["GET", `/api/control/verification/operations/${input.operationId}`],
        ]);
    });
    it.each([
        { id: randomUUID() },
        { challengeId: randomUUID() },
        { gatewayInstanceId: randomUUID() },
        { configVersion: "other" },
        { action: "request-sms" },
        { data: { code: "secret" } },
        { ownerHash: "internal" },
        { status: "running", finishedAt: undefined },
        { status: "running" },
        { status: "failed" },
        { finishedAt: "2026-09-08T00:00:00.000Z" },
    ])("rejects a tampered or nonterminal execute receipt: %j", async patch => {
        const input = command();
        const result = { ...receipt(input), ...patch };
        if (patch.status === "running") delete result.finishedAt;
        const request = vi.fn<ControlTransport["request"]>().mockResolvedValue(result);
        await expect(new ControlClient({ request }).verification.execute(input)).rejects.toThrow(
            "未确认",
        );
        expect(request).toHaveBeenCalledTimes(1);
    });
    it("returns rejected and unknown outcomes without reporting success or retrying", async () => {
        for (const status of ["rejected", "unknown"] as const) {
            const input = command();
            const request = vi
                .fn<ControlTransport["request"]>()
                .mockResolvedValue({ ...receipt(input), status });
            expect((await new ControlClient({ request }).verification.execute(input)).status).toBe(
                status,
            );
            expect(request).toHaveBeenCalledTimes(1);
        }
    });
    it("does not retry transport failure and fixes identity before dispatch", async () => {
        const input = command();
        const original = structuredClone(input);
        const request = vi
            .fn<ControlTransport["request"]>()
            .mockImplementation(async (_method, _path, body) => {
                input.expected.configVersion = "changed";
                const sent = body as ControlVerificationCommand;
                sent.expected.configVersion = "tampered";
                return { ...receipt(original), configVersion: "tampered" } as never;
            });
        await expect(new ControlClient({ request }).verification.execute(input)).rejects.toThrow(
            "未确认",
        );
        expect(original.expected.configVersion).toBe("config-v1");
        expect(request).toHaveBeenCalledTimes(1);
        request.mockRejectedValue(new Error("connection lost"));
        await expect(
            new ControlClient({ request }).verification.execute(command()),
        ).rejects.toThrow("connection lost");
        expect(request).toHaveBeenCalledTimes(2);
    });
    it("permits running receipts only for explicit queries and binds query ID", async () => {
        const input = command();
        const running = { ...receipt(input), status: "running" as const };
        delete running.finishedAt;
        expect(isControlVerificationOperation(running)).toBe(true);
        const request = vi.fn<ControlTransport["request"]>().mockResolvedValue(running);
        expect(
            await new ControlClient({ request }).verification.operation(input.operationId),
        ).toEqual(running);
        await expect(
            new ControlClient({ request }).verification.operation(randomUUID()),
        ).rejects.toThrow("未确认");
    });
    it("rejects invalid commands without dispatching or invoking getters", async () => {
        const input = command();
        const getter = vi.fn(() => "123");
        const accessor = Object.defineProperty({}, "code", { enumerable: true, get: getter });
        for (const invalid of [
            { ...input, data: accessor },
            { ...input, data: { code: " " } },
            { ...input, extra: true },
            { ...input, expected: { ...input.expected, configVersion: "中".repeat(86) } },
            { ...input, data: { code: "中".repeat(6000) } },
            { ...input, operationId: "../operation" },
        ])
            expect(isControlVerificationCommand(invalid)).toBe(false);
        const request = vi.fn<ControlTransport["request"]>();
        await expect(
            new ControlClient({ request }).verification.execute({ ...input, data: accessor }),
        ).rejects.toThrow("无效");
        expect(request).not.toHaveBeenCalled();
        expect(getter).not.toHaveBeenCalled();
    });
    it("rejects malformed, duplicate, excessive or unsafe challenge snapshots", async () => {
        const value = snapshot();
        const challenge = value.challenges[0];
        const getter = vi.fn(() => "secret");
        const accessor = Object.defineProperty({}, "hint", { enumerable: true, get: getter });
        for (const invalid of [
            { ...value, gatewayInstanceId: "bad" },
            { ...value, extra: true },
            { ...value, challenges: [challenge, challenge] },
            { ...value, challenges: new Array(1) },
            {
                ...value,
                challenges: Array.from({ length: 21 }, () => ({ ...challenge, id: randomUUID() })),
            },
            { ...value, challenges: [{ ...challenge, expiresAt: 1800001 }] },
            { ...value, challenges: [{ ...challenge, request: accessor }] },
            {
                ...value,
                challenges: [
                    {
                        ...challenge,
                        request: {
                            ...challenge.request,
                            options: { blocks: [{ type: "script" }] },
                        },
                    },
                ],
            },
            {
                ...value,
                challenges: [
                    {
                        ...challenge,
                        request: { ...challenge.request, data: { invalid: undefined } },
                    },
                ],
            },
        ])
            expect(isControlVerificationSnapshot(invalid)).toBe(false);
        expect(getter).not.toHaveBeenCalled();
        const request = vi
            .fn<ControlTransport["request"]>()
            .mockResolvedValue({ ...value, configVersion: "" });
        await expect(new ControlClient({ request }).verification.pending()).rejects.toThrow("无效");
        expect(request).toHaveBeenCalledTimes(1);
    });
});

it("reconciles only the original ID once and retains the unknown fact", async () => {
    const input = command();
    const result: ControlVerificationOperation = {
        ...receipt(input),
        status: "unknown",
        resolution: { outcome: "succeeded", confirmedAt: "2026-09-09T00:00:02.000Z" },
    };
    const request = vi.fn<ControlTransport["request"]>().mockResolvedValue(result);
    const client = new ControlClient({ request });
    expect(await client.verification.reconcile(input.operationId)).toEqual(result);
    expect(controlVerificationOutcome(result)).toBe("succeeded");
    expect(result.status).toBe("unknown");
    expect(request).toHaveBeenCalledExactlyOnceWith("POST", "/api/control/verification/reconcile", {
        id: input.operationId,
    });
    request.mockResolvedValue({ ...result, id: randomUUID() });
    await expect(client.verification.reconcile(input.operationId)).rejects.toThrow("未确认");
    request.mockRejectedValue(new Error("lost"));
    await expect(client.verification.reconcile(input.operationId)).rejects.toThrow("lost");
    expect(request).toHaveBeenCalledTimes(3);
    await expect(client.verification.reconcile("bad-id")).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(3);
});
it("rejects malformed or retroactive reconciliation evidence", () => {
    const base = { ...receipt(command()), status: "unknown" };
    const resolution = { outcome: "rejected", confirmedAt: "2026-09-09T00:00:02.000Z" };
    expect(isControlVerificationOperation({ ...base, resolution })).toBe(true);
    for (const invalid of [
        { ...base, status: "succeeded", resolution },
        { ...base, resolution: { ...resolution, outcome: "unknown" } },
        { ...base, resolution: { ...resolution, confirmedAt: base.startedAt } },
        { ...base, resolution: { ...resolution, secret: "answer" } },
        { ...base, resolution: { outcome: "rejected" } },
    ])
        expect(isControlVerificationOperation(invalid)).toBe(false);
});

it("requires explicit acceptance and validates acknowledgement without converting unknown to success", async () => {
    const base = { ...receipt(command()), status: "unknown" as const };
    const acknowledgement = { acceptedAt: "2026-09-09T00:00:02.000Z" };
    const result = { ...base, acknowledgement };
    expect(isControlVerificationOperation(result)).toBe(true);
    expect(controlVerificationOutcome(result)).toBe("acknowledged");
    for (const invalid of [
        { ...result, status: "succeeded" },
        { ...result, acknowledgement: { acceptedAt: base.startedAt } },
        { ...result, acknowledgement: { ...acknowledgement, secret: "answer" } },
        { ...result, acknowledgement: {} },
        { ...result, resolution: { outcome: "rejected", confirmedAt: acknowledgement.acceptedAt } },
    ])
        expect(isControlVerificationOperation(invalid)).toBe(false);
    const request = vi.fn<ControlTransport["request"]>().mockResolvedValue(result);
    const client = new ControlClient({ request });
    await expect(client.verification.acknowledge(base.id, false as never)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(await client.verification.acknowledge(base.id, true)).toEqual(result);
    expect(request).toHaveBeenCalledExactlyOnceWith(
        "POST",
        "/api/control/verification/acknowledge",
        { id: base.id, acceptUnknownOutcome: true },
    );
    for (const invalid of [base, { ...result, id: randomUUID() }]) {
        request.mockResolvedValue(invalid);
        await expect(client.verification.acknowledge(base.id, true)).rejects.toThrow("未确认");
    }
    request.mockRejectedValue(new Error("lost"));
    await expect(client.verification.acknowledge(base.id, true)).rejects.toThrow("lost");
    expect(request).toHaveBeenCalledTimes(4);
});

it("封存响应严格绑定原编号及闭合结构，写入和查询都不自动重试", async () => {
    const id = randomUUID();
    const sealed = { id, abandonedAt: new Date(2).toISOString() };
    const request = vi.fn().mockResolvedValue(sealed);
    const client = new ControlClient({ request });
    expect(await client.verification.abandon(id, true)).toEqual(sealed);
    expect(await client.verification.abandonment(id)).toEqual(sealed);
    expect(request.mock.calls).toEqual([
        ["POST", "/api/control/verification/abandon", { id, confirm: true }],
        ["GET", `/api/control/verification/abandonments/${id}`],
    ]);
    for (const malformed of [
        { ...sealed, id: randomUUID() },
        { ...sealed, secret: "x" },
        { id },
        { ...sealed, abandonedAt: "yesterday" },
    ]) {
        request.mockResolvedValue(malformed);
        await expect(client.verification.abandon(id, true)).rejects.toThrow();
        await expect(client.verification.abandonment(id)).rejects.toThrow();
    }
    request.mockRejectedValue(new Error("lost"));
    await expect(client.verification.abandon(id, true)).rejects.toThrow("lost");
    expect(request).toHaveBeenCalledTimes(11);
    await expect(client.verification.abandon("invalid", true)).rejects.toThrow();
    // @ts-expect-error 运行时仍必须拒绝缺少显式确认。
    await expect(client.verification.abandon(id, false)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(11);
});
