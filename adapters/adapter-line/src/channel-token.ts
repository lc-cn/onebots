import { channelAccessToken } from "@line/bot-sdk";
import { LineApiError } from "./errors.js";
import type { LineConfig } from "./types.js";

const DEFAULT_API_BASE = "https://api.line.me";
const ASSERTION_TYPE = "urn:ietf:params:oauth:client-assertion-type:jwt-bearer";

type ChannelTokenApi = Pick<
    channelAccessToken.ChannelAccessTokenClient,
    | "getsAllValidChannelAccessTokenKeyIds"
    | "issueChannelToken"
    | "issueChannelTokenByJWT"
    | "issueStatelessChannelTokenByClientSecret"
    | "issueStatelessChannelTokenByJWTAssertion"
    | "revokeChannelToken"
    | "revokeChannelTokenByJWT"
    | "verifyChannelToken"
    | "verifyChannelTokenByJWT"
>;

/** LINE Channel Access Token API 的独立凭据边界。 */
export class LineChannelTokenClient {
    private readonly api: ChannelTokenApi;

    constructor(
        private readonly config: Pick<
            LineConfig,
            "api_base_url" | "manage_channel_tokens" | "channel_id" | "channel_secret"
        >,
        api?: ChannelTokenApi,
    ) {
        this.api =
            api ||
            new channelAccessToken.ChannelAccessTokenClient({
                baseURL: config.api_base_url || DEFAULT_API_BASE,
            });
    }

    issueShortLived() {
        const credentials = this.requireCredentials();
        return this.api.issueChannelToken(
            "client_credentials",
            credentials.clientId,
            credentials.clientSecret,
        );
    }

    issueStatelessByClientSecret() {
        const credentials = this.requireCredentials();
        return this.api.issueStatelessChannelTokenByClientSecret(
            credentials.clientId,
            credentials.clientSecret,
        );
    }

    issueV21(clientAssertion: string) {
        return this.api.issueChannelTokenByJWT(
            "client_credentials",
            ASSERTION_TYPE,
            required(clientAssertion, "client_assertion"),
        );
    }

    issueStatelessByJwt(clientAssertion: string) {
        return this.api.issueStatelessChannelTokenByJWTAssertion(
            required(clientAssertion, "client_assertion"),
        );
    }

    listV21KeyIds(clientAssertion: string) {
        return this.api.getsAllValidChannelAccessTokenKeyIds(
            ASSERTION_TYPE,
            required(clientAssertion, "client_assertion"),
        );
    }

    verify(accessToken: string) {
        return this.api.verifyChannelToken(required(accessToken, "access_token"));
    }

    verifyV21(accessToken: string) {
        return this.api.verifyChannelTokenByJWT(required(accessToken, "access_token"));
    }

    revoke(accessToken: string) {
        return this.api.revokeChannelToken(required(accessToken, "access_token"));
    }

    revokeV21(accessToken: string) {
        const credentials = this.requireCredentials();
        return this.api.revokeChannelTokenByJWT(
            credentials.clientId,
            credentials.clientSecret,
            required(accessToken, "access_token"),
        );
    }

    private requireCredentials(): { clientId: string; clientSecret: string } {
        if (
            this.config.manage_channel_tokens !== true ||
            !this.config.channel_id?.trim() ||
            !this.config.channel_secret?.trim()
        ) {
            throw new LineApiError(
                "LINE 令牌签发或凭据撤销需要启用 manage_channel_tokens 并配置 channel_id 与 channel_secret",
                { code: "LINE_CHANNEL_CREDENTIALS_REQUIRED" },
            );
        }
        return { clientId: this.config.channel_id, clientSecret: this.config.channel_secret };
    }
}

function required(value: string, field: string): string {
    if (!value.trim()) {
        throw new LineApiError(`LINE ${field} 不能为空`, {
            code: "LINE_INVALID_ACTION_PARAMS",
            details: { field },
        });
    }
    return value;
}
