import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export interface WhatsAppEncryptedMessageResponse {
    encrypted_contents: string;
}

/**
 * Payload Encryption 消息入口。
 *
 * 密钥与明文生命周期由业务持有；该模块只校验 compact JWE 外形、约束 Graph
 * 请求字段并校验加密响应，避免通用 call() 意外夹带明文或额外字段。
 */
export class WhatsAppEncryptedMessages {
    constructor(private readonly client: WhatsAppClient) {}

    async send(encryptedContents: string): Promise<WhatsAppEncryptedMessageResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/messages_encrypted`,
            body: {
                messaging_product: "whatsapp",
                encrypted_contents: compactJwe(encryptedContents),
            },
        });
        return encryptedResponse(response);
    }
}

type EncryptedMessageActionParams = Readonly<Record<string, unknown>>;

const ENCRYPTED_MESSAGE_ACTION_HANDLERS = {
    send_encrypted_message: (client: WhatsAppClient, params: EncryptedMessageActionParams) =>
        client.encryptedMessages.send(requiredText(params, "encrypted_contents")),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Payload Encryption 动作的执行与参数契约单一来源。 */
export const WHATSAPP_ENCRYPTED_MESSAGE_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    ENCRYPTED_MESSAGE_ACTION_HANDLERS,
    { send_encrypted_message: ["encrypted_contents"] },
);

export type WhatsAppEncryptedMessageAction =
    keyof typeof WHATSAPP_ENCRYPTED_MESSAGE_ACTION_HANDLERS;

export function isWhatsAppEncryptedMessageAction(
    action: string,
): action is WhatsAppEncryptedMessageAction {
    return Object.hasOwn(WHATSAPP_ENCRYPTED_MESSAGE_ACTION_HANDLERS, action);
}

function compactJwe(value: string): string {
    const token = value.trim();
    const segments = token.split(".");
    if (
        token !== value ||
        segments.length !== 5 ||
        segments.some(segment => !segment || !/^[A-Za-z\d_-]+$/u.test(segment))
    ) {
        invalidParameter("encrypted_contents 必须是五段无填充的 compact JWE");
    }
    return token;
}

function encryptedResponse(value: unknown): WhatsAppEncryptedMessageResponse {
    if (!isRecord(value) || typeof value.encrypted_contents !== "string") {
        throw new WhatsAppApiError("WhatsApp 加密消息响应缺少 encrypted_contents", {
            code: "WHATSAPP_INVALID_RESPONSE",
            details: value,
        });
    }
    return { encrypted_contents: compactJwe(value.encrypted_contents) };
}

function requiredText(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, {
        code: "WHATSAPP_INVALID_PARAMETER",
    });
}
