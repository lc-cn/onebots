import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { GatewayStartMessage } from "./contracts.js";
import { GatewayVerificationStore } from "./verification-store.js";
import {
    isGatewayVerificationReply,
    isGatewayVerificationRequest,
} from "./verification-contracts.js";
import { handleGatewayVerification } from "./verification-ipc.js";

function fixture() {
    const identity: GatewayStartMessage = {
        type: "gateway.start",
        protocolVersion: 1,
        controlInstanceId: randomUUID(),
        gatewayInstanceId: randomUUID(),
        configVersion: "config-1",
        dependencyVersion: "deps-1",
        configPath: "/tmp/unused-config",
        workspacePath: "/tmp/unused-workspace",
        selection: { adapters: [], protocols: [], applications: [] },
    };
    const value = {
        type: "gateway.verification",
        protocolVersion: 1,
        controlInstanceId: identity.controlInstanceId,
        gatewayInstanceId: identity.gatewayInstanceId,
        configVersion: identity.configVersion,
        requestId: randomUUID(),
        action: "list",
    };
    const store = new GatewayVerificationStore();
    store.record({ platform: "mock", account_id: "bot", type: "sms", hint: "请输入验证码" });
    return { identity, value, store };
}
it("只读挑战回执严格绑定实例及配置，旧请求不响应", () => {
    const { identity, value, store } = fixture();
    const send = vi.fn();
    expect(handleGatewayVerification(value, identity, store, undefined, send)).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    const reply = send.mock.calls[0][0];
    expect(isGatewayVerificationReply(reply)).toBe(true);
    expect(reply).toMatchObject({
        configVersion: "config-1",
        outcome: "succeeded",
        challenges: [
            expect.objectContaining({
                request: { platform: "mock", account_id: "bot", type: "sms", hint: "请输入验证码" },
            }),
        ],
    });
    send.mockClear();
    handleGatewayVerification({ ...value, configVersion: "old" }, identity, store, undefined, send);
    handleGatewayVerification(
        { ...value, gatewayInstanceId: randomUUID() },
        identity,
        store,
        undefined,
        send,
    );
    expect(send).not.toHaveBeenCalled();
});
it("校验拒绝访问器、重复挑战和超量列表", () => {
    const { identity, value, store } = fixture();
    const send = vi.fn();
    handleGatewayVerification(value, identity, store, undefined, send);
    const reply = send.mock.calls[0][0];
    expect(
        isGatewayVerificationReply({ ...reply, challenges: Array(21).fill(reply.challenges[0]) }),
    ).toBe(false);
    expect(
        isGatewayVerificationReply({
            ...reply,
            challenges: [reply.challenges[0], reply.challenges[0]],
        }),
    ).toBe(false);
    const getter = vi.fn(() => "secret");
    const bad = {
        ...reply.challenges[0],
        request: {
            ...reply.challenges[0].request,
            get hint() {
                return getter();
            },
        },
    };
    expect(isGatewayVerificationReply({ ...reply, challenges: [bad] })).toBe(false);
    expect(getter).not.toHaveBeenCalled();
    expect(isGatewayVerificationRequest({ ...value, command: {} })).toBe(false);
    expect(isGatewayVerificationReply({ ...reply, outcome: { toString: getter } })).toBe(false);
    expect(getter).not.toHaveBeenCalled();
});
it("停止或执行器缺失时明确拒绝，断连发送异常不会重发", () => {
    const { identity, value } = fixture();
    const send = vi.fn();
    handleGatewayVerification(value, identity, undefined, undefined, send);
    expect(send.mock.calls[0][0]).toMatchObject({ outcome: "rejected" });
    const disconnected = vi.fn(() => {
        throw new Error("disconnected");
    });
    expect(() =>
        handleGatewayVerification(value, identity, undefined, undefined, disconnected),
    ).not.toThrow();
    expect(disconnected).toHaveBeenCalledOnce();
});
