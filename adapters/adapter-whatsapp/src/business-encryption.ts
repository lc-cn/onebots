import { createPublicKey } from "node:crypto";
import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export type WhatsAppBusinessPublicKeySignatureStatus = "VALID" | "MISMATCH";

export interface WhatsAppBusinessEncryptionInfo {
    business_public_key: string;
    business_public_key_signature_status: WhatsAppBusinessPublicKeySignatureStatus;
}

export interface WhatsAppBusinessEncryptionResponse {
    data: WhatsAppBusinessEncryptionInfo[];
}

export interface WhatsAppBusinessEncryptionUpdateResponse {
    success: true;
}

/** Flow/data-channel Business Encryption 公钥控制平面，不持有业务私钥。 */
export class WhatsAppBusinessEncryption {
    constructor(private readonly client: WhatsAppClient) {}

    async get(): Promise<WhatsAppBusinessEncryptionResponse> {
        return encryptionResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/whatsapp_business_encryption`,
                query: {
                    fields: "business_public_key,business_public_key_signature_status",
                },
            }),
        );
    }

    async set(publicKey: string): Promise<WhatsAppBusinessEncryptionUpdateResponse> {
        const form = new FormData();
        form.append("business_public_key", rsaPublicKey(publicKey));
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/whatsapp_business_encryption`,
            body: form,
        });
        if (!isRecord(response) || response.success !== true) invalidResponse(response);
        return { success: true };
    }
}

type BusinessEncryptionActionParams = Readonly<Record<string, unknown>>;

const BUSINESS_ENCRYPTION_ACTION_HANDLERS = {
    get_business_encryption_key: (client: WhatsAppClient) => client.businessEncryption.get(),
    set_business_encryption_key: (client: WhatsAppClient, params: BusinessEncryptionActionParams) =>
        client.businessEncryption.set(requiredText(params, "business_public_key")),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Business Encryption 动作的执行与参数契约单一来源。 */
export const WHATSAPP_BUSINESS_ENCRYPTION_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    BUSINESS_ENCRYPTION_ACTION_HANDLERS,
    {
        get_business_encryption_key: [],
        set_business_encryption_key: ["business_public_key"],
    },
);

export type WhatsAppBusinessEncryptionAction =
    keyof typeof WHATSAPP_BUSINESS_ENCRYPTION_ACTION_HANDLERS;

export function isWhatsAppBusinessEncryptionAction(
    action: string,
): action is WhatsAppBusinessEncryptionAction {
    return Object.hasOwn(WHATSAPP_BUSINESS_ENCRYPTION_ACTION_HANDLERS, action);
}

function encryptionResponse(value: unknown): WhatsAppBusinessEncryptionResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return { data: value.data.map(encryptionInfo) };
}

function encryptionInfo(value: unknown): WhatsAppBusinessEncryptionInfo {
    if (
        !isRecord(value) ||
        typeof value.business_public_key !== "string" ||
        !signatureStatus(value.business_public_key_signature_status)
    ) {
        invalidResponse(value);
    }
    if (
        value.business_public_key_signature_status === "VALID" &&
        !value.business_public_key.trim()
    ) {
        invalidResponse(value);
    }
    return {
        business_public_key: value.business_public_key,
        business_public_key_signature_status: value.business_public_key_signature_status,
    };
}

function rsaPublicKey(value: string): string {
    const pem = value.trim();
    if (!pem) invalidParameter("business_public_key 不能为空");
    try {
        const key = createPublicKey(pem);
        if (key.type !== "public" || key.asymmetricKeyType !== "rsa") {
            invalidParameter("business_public_key 必须是 RSA 公钥");
        }
        const modulusLength = key.asymmetricKeyDetails?.modulusLength;
        if (typeof modulusLength !== "number" || modulusLength < 2048) {
            invalidParameter("business_public_key 必须至少为 2048 位 RSA 公钥");
        }
    } catch (error) {
        if (error instanceof WhatsAppApiError) throw error;
        throw new WhatsAppApiError("WhatsApp business_public_key 不是有效 PEM 公钥", {
            code: "WHATSAPP_INVALID_PARAMETER",
            cause: error,
        });
    }
    return pem;
}

function signatureStatus(value: unknown): value is WhatsAppBusinessPublicKeySignatureStatus {
    return value === "VALID" || value === "MISMATCH";
}

function requiredText(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Business Encryption 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
