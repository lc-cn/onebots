import { describe, expect, it, vi } from "vitest";
import {
    assertAuthenticationResponseIdentity,
    authenticationExchangeHeaders,
    verifyAuthenticationTarget,
} from "./authentication-target.js";

const identity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract-a",
};

function healthResponse(instanceId = "instance-a"): Response {
    return Response.json({
        status: "ok",
        application: "onebots",
        version: "1.2.8",
        instance_id: instanceId,
        runtime_contract_id: "sha256:contract-a",
    });
}

function managementResponse(instanceId = "instance-a"): Response {
    return new Response(null, {
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
        },
    });
}

describe("authentication target", () => {
    it("只接受具有完整公开身份的健康 OneBots", async () => {
        const fetcher = vi.fn(async () => healthResponse());

        await expect(verifyAuthenticationTarget(fetcher)).resolves.toEqual({
            ok: true,
            identity,
        });
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it("通用成功页和不可达端点都不会获得管理凭据", async () => {
        await expect(
            verifyAuthenticationTarget(vi.fn(async () => Response.json({ status: "ok" }))),
        ).resolves.toMatchObject({
            ok: false,
            message: expect.stringContaining("拒绝发送管理凭据"),
        });
        await expect(
            verifyAuthenticationTarget(
                vi.fn(async () => {
                    throw new Error("connection refused");
                }),
            ),
        ).resolves.toMatchObject({ ok: false, message: expect.stringContaining("health 不可达") });
    });

    it("发送预期实例并拒绝另一个实例的认证回执", () => {
        expect(authenticationExchangeHeaders(identity).get("X-OneBots-Expected-Instance-Id")).toBe(
            "instance-a",
        );
        expect(() =>
            assertAuthenticationResponseIdentity(managementResponse(), identity),
        ).not.toThrow();
        expect(() =>
            assertAuthenticationResponseIdentity(managementResponse("instance-b"), identity),
        ).toThrow("认证响应实例不匹配");
    });
});
