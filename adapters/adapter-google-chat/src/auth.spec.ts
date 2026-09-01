import { OAuth2Client, type LoginTicket } from "google-auth-library";
import { describe, expect, it, vi } from "vitest";
import { GoogleChatAuth } from "./auth.js";

describe("GoogleChatAuth 请求身份校验", () => {
    it("把启动信号传给 OAuth transport 并中止凭证请求", async () => {
        const controller = new AbortController();
        const getAccessToken = vi.fn(
            () =>
                new Promise<string>((_resolve, reject) => {
                    controller.signal.addEventListener("abort", () =>
                        reject(new DOMException("aborted", "AbortError")),
                    );
                }),
        );
        const factory = vi.fn(() => ({ getAccessToken }));
        const auth = new GoogleChatAuth(serviceAccountConfig(), fetch, undefined, factory);

        const request = auth.accessToken(controller.signal);
        await vi.waitFor(() => expect(getAccessToken).toHaveBeenCalledOnce());
        expect(factory).toHaveBeenCalledWith(controller.signal);
        controller.abort();

        await expect(request).rejects.toMatchObject({ name: "AbortError" });
    });

    it("reset 后拒绝迟到凭证并为新生命周期创建独立 OAuth 客户端", async () => {
        let resolveOld!: (token: string) => void;
        const factory = vi
            .fn()
            .mockReturnValueOnce({
                getAccessToken: () =>
                    new Promise<string>(resolve => {
                        resolveOld = resolve;
                    }),
            })
            .mockReturnValueOnce({ getAccessToken: vi.fn().mockResolvedValue("fresh") });
        const auth = new GoogleChatAuth(serviceAccountConfig(), fetch, undefined, factory);

        const old = auth.accessToken(new AbortController().signal);
        await vi.waitFor(() => expect(factory).toHaveBeenCalledOnce());
        auth.reset();
        resolveOld("late");

        await expect(old).rejects.toMatchObject({ code: "GOOGLE_CHAT_AUTH_CANCELLED" });
        await expect(auth.accessToken(new AbortController().signal)).resolves.toBe("fresh");
        expect(factory).toHaveBeenCalledTimes(2);
    });

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

function serviceAccountConfig() {
    return {
        account_id: "bot",
        auth_mode: "service-account" as const,
        service_account_email: "bot@example.iam.gserviceaccount.com",
        service_account_private_key: "private-key",
    };
}

function verifier(payload: Record<string, unknown>) {
    const ticket = { getPayload: () => payload } as unknown as LoginTicket;
    return {
        verifyIdToken: vi.fn().mockResolvedValue(ticket),
        verifySignedJwtWithCertsAsync: vi.fn().mockResolvedValue(ticket),
    } as unknown as Pick<OAuth2Client, "verifyIdToken" | "verifySignedJwtWithCertsAsync">;
}
