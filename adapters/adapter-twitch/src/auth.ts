import { TwitchError } from "./errors.js";
import type { TwitchConfig, TwitchTokenInfo } from "./types.js";
import { isRecord } from "./validation.js";

const TOKEN_VALIDATE_URL = "https://id.twitch.tv/oauth2/validate";
const MAX_VALIDATE_BYTES = 64 * 1024;

/** 通过 Twitch OAuth validation endpoint 获取令牌主体、类型、scope 与剩余寿命。 */
export async function validateTwitchToken(
    config: Pick<TwitchConfig, "access_token" | "client_id">,
    fetcher: typeof fetch = fetch,
    signal?: AbortSignal,
): Promise<TwitchTokenInfo> {
    let response: Response;
    try {
        response = await fetcher(TOKEN_VALIDATE_URL, {
            headers: { Authorization: `OAuth ${normalizeToken(config.access_token)}` },
            signal,
        });
    } catch (error) {
        throw TwitchError.wrap(error, "Twitch OAuth 令牌验证请求失败", "TWITCH_AUTH_NETWORK_ERROR");
    }
    const text = await readTextBounded(response, MAX_VALIDATE_BYTES);
    const payload = parseJson(text);
    if (!response.ok) {
        const message =
            isRecord(payload) && typeof payload.message === "string"
                ? payload.message
                : `Twitch OAuth validation 返回 HTTP ${response.status}`;
        throw new TwitchError(message, {
            code: "TWITCH_AUTH_INVALID",
            status: response.status,
            details: payload,
        });
    }
    const token = parseTokenInfo(payload);
    if (token.client_id !== config.client_id) {
        throw new TwitchError(
            `access_token 属于 Client-Id ${token.client_id}，与配置 ${config.client_id} 不一致`,
            { code: "TWITCH_CLIENT_ID_MISMATCH", details: token },
        );
    }
    return token;
}

export function parseTokenInfo(value: unknown): TwitchTokenInfo {
    if (!isRecord(value)) throw TwitchError.protocol("Twitch OAuth validation 响应必须是对象");
    const clientId = nonEmpty(value.client_id, "token.client_id");
    const login = optionalNonEmpty(value.login, "token.login");
    const userId = optionalId(value.user_id, "token.user_id");
    if (
        !Array.isArray(value.scopes) ||
        value.scopes.some(scope => typeof scope !== "string" || !scope)
    ) {
        throw TwitchError.protocol("token.scopes 必须是非空字符串数组");
    }
    if (!Number.isSafeInteger(value.expires_in) || (value.expires_in as number) < 0) {
        throw TwitchError.protocol("token.expires_in 必须是非负整数");
    }
    return {
        client_id: clientId,
        login,
        scopes: [...new Set(value.scopes as string[])],
        user_id: userId,
        expires_in: value.expires_in as number,
    };
}

function normalizeToken(value: string): string {
    const token = value.replace(/^oauth:/u, "").trim();
    if (!token) throw TwitchError.invalid("access_token 不能为空");
    return token;
}

async function readTextBounded(response: Response, maxBytes: number): Promise<string> {
    const declared = Number(response.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > maxBytes) {
        throw new TwitchError("Twitch OAuth validation 响应超过大小上限", {
            code: "TWITCH_AUTH_RESPONSE_TOO_LARGE",
            status: response.status,
        });
    }
    if (!response.body) return "";
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > maxBytes) {
                await reader.cancel();
                throw new TwitchError("Twitch OAuth validation 响应超过大小上限", {
                    code: "TWITCH_AUTH_RESPONSE_TOO_LARGE",
                    status: response.status,
                });
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
}

function parseJson(text: string): unknown {
    if (!text) return undefined;
    try {
        return JSON.parse(text) as unknown;
    } catch (error) {
        throw TwitchError.wrap(
            error,
            "Twitch OAuth validation 返回了无效 JSON",
            "TWITCH_AUTH_INVALID_RESPONSE",
        );
    }
}

function nonEmpty(value: unknown, field: string): string {
    if (typeof value !== "string" || !value)
        throw TwitchError.protocol(`${field} 必须是非空字符串`);
    return value;
}

function optionalNonEmpty(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : nonEmpty(value, field);
}

function optionalId(value: unknown, field: string): string | undefined {
    const id = optionalNonEmpty(value, field);
    if (id !== undefined && !/^\d+$/u.test(id))
        throw TwitchError.protocol(`${field} 必须是 Twitch 数字 ID`);
    return id;
}
