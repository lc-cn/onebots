import { describe, expect, test, vi } from "vitest";
import { LineChannelTokenClient } from "./channel-token.js";

describe("LINE Channel Access Token client", () => {
    test("从配置读取凭据签发并撤销令牌", async () => {
        const api = {
            issueChannelToken: vi.fn().mockResolvedValue({ access_token: "short" }),
            issueStatelessChannelTokenByClientSecret: vi
                .fn()
                .mockResolvedValue({ access_token: "stateless" }),
            revokeChannelTokenByJWT: vi.fn().mockResolvedValue({}),
        };
        const client = new LineChannelTokenClient(
            { manage_channel_tokens: true, channel_id: "123456", channel_secret: "secret" },
            api as never,
        );

        await client.issueShortLived();
        await client.issueStatelessByClientSecret();
        await client.revokeV21("old-token");

        expect(api.issueChannelToken).toHaveBeenCalledWith(
            "client_credentials",
            "123456",
            "secret",
        );
        expect(api.issueStatelessChannelTokenByClientSecret).toHaveBeenCalledWith(
            "123456",
            "secret",
        );
        expect(api.revokeChannelTokenByJWT).toHaveBeenCalledWith("123456", "secret", "old-token");
    });

    test("JWT 动作固定官方 grant 与 assertion type", async () => {
        const api = {
            issueChannelTokenByJWT: vi.fn().mockResolvedValue({ access_token: "v2.1" }),
            getsAllValidChannelAccessTokenKeyIds: vi.fn().mockResolvedValue({ kids: [] }),
        };
        const client = new LineChannelTokenClient({}, api as never);

        await client.issueV21("signed-jwt");
        await client.listV21KeyIds("signed-jwt");

        expect(api.issueChannelTokenByJWT).toHaveBeenCalledWith(
            "client_credentials",
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "signed-jwt",
        );
        expect(api.getsAllValidChannelAccessTokenKeyIds).toHaveBeenCalledWith(
            "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "signed-jwt",
        );
    });

    test("缺少渠道凭据时拒绝签发", async () => {
        const client = new LineChannelTokenClient({}, {} as never);
        expect(() => client.issueShortLived()).toThrowError(
            expect.objectContaining({
                code: "LINE_CHANNEL_CREDENTIALS_REQUIRED",
            }),
        );
    });
});
