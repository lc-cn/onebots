import { AESCipher } from "@larksuiteoapi/node-sdk";
import { FeishuError } from "./errors.js";
import { isFeishuWebhookBody } from "./guards.js";
import type { FeishuConfig, FeishuWebhookBody } from "./types.js";

interface WebhookResponse {
    status?: number;
    body: Record<string, unknown>;
}

export type FeishuWebhookResolution =
    | { body: FeishuWebhookBody }
    | { response: WebhookResponse; error?: FeishuError };

/** 解密并认证 Webhook envelope；HTTP 适配层只负责写回结构化结果。 */
export function resolveFeishuWebhook(
    input: unknown,
    config: Pick<FeishuConfig, "encrypt_key" | "verification_token">,
): FeishuWebhookResolution {
    if (!isFeishuWebhookBody(input)) {
        return {
            response: { status: 400, body: { code: 1, msg: "飞书 Webhook body 必须为对象" } },
        };
    }
    let body = input;
    if (body.encrypt) {
        if (!config.encrypt_key) {
            return {
                response: {
                    status: 400,
                    body: { code: 1, msg: "收到加密事件但未配置 encrypt_key" },
                },
            };
        }
        try {
            const decrypted: unknown = JSON.parse(
                new AESCipher(config.encrypt_key).decrypt(body.encrypt),
            );
            if (!isFeishuWebhookBody(decrypted)) {
                throw new FeishuError("飞书解密载荷不是对象", {
                    code: "FEISHU_WEBHOOK_DECRYPT_FAILED",
                    operation: "webhook",
                    details: decrypted,
                });
            }
            body = decrypted;
        } catch (error) {
            return {
                response: { status: 400, body: { code: 1, msg: "飞书事件解密失败" } },
                error: FeishuError.wrap(error, "FEISHU_WEBHOOK_DECRYPT_FAILED", "webhook"),
            };
        }
    }
    const token = body.header?.token ?? body.token;
    if (config.verification_token && token !== config.verification_token) {
        return {
            response: {
                status: 401,
                body: { code: 1, msg: "Invalid verification token" },
            },
        };
    }
    if (body.type === "url_verification") {
        return { response: { body: { challenge: body.challenge } } };
    }
    return { body };
}
