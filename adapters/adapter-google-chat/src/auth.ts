import { GoogleAuth, OAuth2Client, type LoginTicket } from "google-auth-library";
import { GoogleChatError } from "./errors.js";
import type { GoogleChatConfig, GoogleChatVerificationMode } from "./types.js";
import { isRecord } from "./validation.js";

const CHAT_ISSUER = "chat@system.gserviceaccount.com";
const CHAT_CERTS_URL = `https://www.googleapis.com/service_accounts/v1/metadata/x509/${CHAT_ISSUER}`;
const DEFAULT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

export interface GoogleChatTokenVerifier {
    verify(
        token: string,
        mode: GoogleChatVerificationMode,
        audience: string,
        expectedEmail?: string,
    ): Promise<void>;
}

export class GoogleChatAuth implements GoogleChatTokenVerifier {
    private readonly oauth: Pick<OAuth2Client, "verifyIdToken" | "verifySignedJwtWithCertsAsync">;
    private readonly auth?: GoogleAuth;
    private certs?: { value: Record<string, string>; expiresAt: number };

    constructor(
        private readonly config: GoogleChatConfig,
        private readonly fetcher: typeof fetch = fetch,
        oauth: Pick<
            OAuth2Client,
            "verifyIdToken" | "verifySignedJwtWithCertsAsync"
        > = new OAuth2Client(),
    ) {
        this.oauth = oauth;
        if ((config.auth_mode || "service-account") === "service-account") {
            this.auth = new GoogleAuth({
                credentials: {
                    client_email: config.service_account_email,
                    private_key: config.service_account_private_key,
                },
                scopes: config.oauth_scopes?.length ? config.oauth_scopes : [DEFAULT_SCOPE],
            });
        }
    }

    async accessToken(): Promise<string> {
        if ((this.config.auth_mode || "service-account") === "access-token") {
            if (!this.config.access_token) throw GoogleChatError.invalid("access_token 未配置");
            return this.config.access_token;
        }
        const token = await this.auth?.getAccessToken();
        if (!token)
            throw new GoogleChatError("Google OAuth 未返回 access token", {
                code: "GOOGLE_CHAT_AUTH_ERROR",
            });
        return token;
    }

    async verify(
        token: string,
        mode: GoogleChatVerificationMode,
        audience: string,
        expectedEmail?: string,
    ): Promise<void> {
        let ticket: LoginTicket;
        try {
            ticket =
                mode === "project-number"
                    ? await this.oauth.verifySignedJwtWithCertsAsync(
                          token,
                          await this.getChatCerts(),
                          audience,
                          [CHAT_ISSUER],
                      )
                    : await this.oauth.verifyIdToken({ idToken: token, audience });
        } catch (error) {
            throw new GoogleChatError("Google Chat 请求签名无效", {
                code: "GOOGLE_CHAT_INVALID_TOKEN",
                status: 401,
                cause: error,
            });
        }
        const payload = ticket.getPayload();
        // Project Number 模式已经由 verifySignedJwtWithCertsAsync 同时闭合证书、issuer 与 audience。
        // 该自签 JWT 不是 OIDC ID token，官方载荷不承诺 email/email_verified。
        if (mode === "project-number") {
            if (!payload) {
                throw new GoogleChatError("Google Chat JWT 缺少载荷", {
                    code: "GOOGLE_CHAT_INVALID_IDENTITY",
                    status: 401,
                });
            }
            return;
        }
        const requiredEmail = mode === "pubsub" ? expectedEmail : CHAT_ISSUER;
        if (!payload || payload.email !== requiredEmail || payload.email_verified !== true) {
            throw new GoogleChatError("Google Chat 请求身份不匹配", {
                code: "GOOGLE_CHAT_INVALID_IDENTITY",
                status: 401,
            });
        }
    }

    private async getChatCerts(): Promise<Record<string, string>> {
        if (this.certs && this.certs.expiresAt > Date.now()) return this.certs.value;
        const response = await this.fetcher(CHAT_CERTS_URL);
        if (!response.ok)
            throw GoogleChatError.network(`获取 Google Chat 公钥失败: HTTP ${response.status}`);
        const body: unknown = await response.json();
        if (!isRecord(body) || Object.values(body).some(value => typeof value !== "string")) {
            throw new GoogleChatError("Google Chat 公钥响应无效", {
                code: "GOOGLE_CHAT_INVALID_CERTS",
            });
        }
        const maxAge = response.headers.get("cache-control")?.match(/max-age=(\d+)/u)?.[1];
        this.certs = {
            value: body as Record<string, string>,
            expiresAt: Date.now() + Number(maxAge || 300) * 1000,
        };
        return this.certs.value;
    }
}
