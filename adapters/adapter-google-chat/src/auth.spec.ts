import { OAuth2Client, type LoginTicket } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { GoogleChatAuth } from "./auth.js";

describe("GoogleChatAuth 请求身份校验", () => {
    it("Project Number 自签 JWT 不错误要求 OIDC email 字段", async () => {
        const oauth = verifier({ iss: "chat@system.gserviceaccount.com", aud: "123456" });
        const auth = new GoogleChatAuth(
            { account_id: "bot" },
            vi
                .fn<typeof fetch>()
                .mockResolvedValue(
                    Response.json(
                        { key: "certificate" },
                        { headers: { "cache-control": "public, max-age=600" } },
                    ),
                ),
            oauth,
        );

        await expect(auth.verify("signed", "project-number", "123456")).resolves.toBeUndefined();
        expect(oauth.verifySignedJwtWithCertsAsync).toHaveBeenCalledWith(
            "signed",
            { key: "certificate" },
            "123456",
            ["chat@system.gserviceaccount.com"],
        );
    });

    it("Endpoint OIDC 与 Pub/Sub OIDC 都要求已验证且精确匹配的邮箱", async () => {
        const valid = verifier({
            email: "chat@system.gserviceaccount.com",
            email_verified: true,
        });
        const auth = new GoogleChatAuth({ account_id: "bot" }, fetch, valid);
        await expect(
            auth.verify("oidc", "endpoint-url", "https://example.com/chat"),
        ).resolves.toBeUndefined();

        const invalid = new GoogleChatAuth(
            { account_id: "bot" },
            fetch,
            verifier({ email: "attacker@example.com", email_verified: true }),
        );
        await expect(
            invalid.verify("oidc", "pubsub", "audience", "push@example.com"),
        ).rejects.toMatchObject({ code: "GOOGLE_CHAT_INVALID_IDENTITY", status: 401 });
    });
});

function verifier(payload: Record<string, unknown>) {
    const ticket = { getPayload: () => payload } as unknown as LoginTicket;
    return {
        verifyIdToken: vi.fn().mockResolvedValue(ticket),
        verifySignedJwtWithCertsAsync: vi.fn().mockResolvedValue(ticket),
    } as unknown as Pick<OAuth2Client, "verifyIdToken" | "verifySignedJwtWithCertsAsync">;
}
