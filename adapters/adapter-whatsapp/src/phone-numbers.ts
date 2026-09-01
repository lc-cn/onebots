import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppPhoneNumberInfo } from "./types.js";

export type WhatsAppVerificationCodeMethod = "SMS" | "VOICE";

export interface WhatsAppPhoneNumberRegistration {
    pin: string;
    backup?: {
        password: string;
        data: string;
    };
}

export interface WhatsAppVerificationCodeRequest {
    code_method: WhatsAppVerificationCodeMethod;
    language: string;
}

export interface WhatsAppSuccessResponse {
    success: true;
}

export interface WhatsAppVerificationCodeResponse extends WhatsAppSuccessResponse {
    id: string;
}

/** 号码资料、注册、两步验证与所有权验证的强类型控制平面。 */
export class WhatsAppPhoneNumbers {
    constructor(private readonly client: WhatsAppClient) {}

    async getInfo(signal?: AbortSignal): Promise<WhatsAppPhoneNumberInfo> {
        return phoneNumberInfo(
            await this.client.call<unknown>({
                resource: this.client.config.phone_number_id,
                signal,
                query: {
                    fields: "id,display_phone_number,verified_name,quality_rating,code_verification_status,name_status",
                },
            }),
        );
    }

    async register(params: WhatsAppPhoneNumberRegistration): Promise<WhatsAppSuccessResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/register`,
                body: {
                    messaging_product: "whatsapp",
                    pin: sixDigits(params.pin, "pin"),
                    ...(params.backup ? { backup: backupPayload(params.backup) } : {}),
                },
            }),
            "号码注册",
        );
    }

    async deregister(): Promise<WhatsAppSuccessResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/deregister`,
            }),
            "号码注销",
        );
    }

    async setTwoStepVerification(pin: string): Promise<WhatsAppSuccessResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: this.client.config.phone_number_id,
                body: { pin: sixDigits(pin, "pin") },
            }),
            "两步验证设置",
        );
    }

    async requestVerificationCode(
        params: WhatsAppVerificationCodeRequest,
    ): Promise<WhatsAppSuccessResponse> {
        return successResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/request_code`,
                body: {
                    code_method: codeMethod(params.code_method),
                    language: locale(params.language),
                },
            }),
            "验证码申请",
        );
    }

    async verifyCode(code: string): Promise<WhatsAppVerificationCodeResponse> {
        const value = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/verify_code`,
            body: { code: sixDigits(code, "code") },
        });
        if (!isRecord(value) || value.success !== true || !nonEmptyText(value.id)) {
            invalidResponse("验证码校验", value);
        }
        return { success: true, id: value.id };
    }
}

type PhoneNumberActionParams = Readonly<Record<string, unknown>>;

const PHONE_NUMBER_ACTION_HANDLERS = {
    get_phone_number_info: (client: WhatsAppClient) => client.phoneNumbers.getInfo(),
    register_phone_number: (client: WhatsAppClient, params: PhoneNumberActionParams) =>
        client.phoneNumbers.register(registrationParams(params)),
    deregister_phone_number: (client: WhatsAppClient) => client.phoneNumbers.deregister(),
    set_two_step_verification: (client: WhatsAppClient, params: PhoneNumberActionParams) =>
        client.phoneNumbers.setTwoStepVerification(requiredText(params, "pin")),
    request_phone_number_verification_code: (
        client: WhatsAppClient,
        params: PhoneNumberActionParams,
    ) =>
        client.phoneNumbers.requestVerificationCode({
            code_method: actionCodeMethod(params),
            language: requiredText(params, "language"),
        }),
    verify_phone_number_code: (client: WhatsAppClient, params: PhoneNumberActionParams) =>
        client.phoneNumbers.verifyCode(requiredText(params, "code")),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Phone Number 动作的执行与参数契约单一来源。 */
export const WHATSAPP_PHONE_NUMBER_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    PHONE_NUMBER_ACTION_HANDLERS,
    {
        get_phone_number_info: [],
        register_phone_number: ["pin", "backup"],
        deregister_phone_number: [],
        set_two_step_verification: ["pin"],
        request_phone_number_verification_code: ["code_method", "language"],
        verify_phone_number_code: ["code"],
    },
);

export type WhatsAppPhoneNumberAction = keyof typeof WHATSAPP_PHONE_NUMBER_ACTION_HANDLERS;

export function isWhatsAppPhoneNumberAction(action: string): action is WhatsAppPhoneNumberAction {
    return Object.hasOwn(WHATSAPP_PHONE_NUMBER_ACTION_HANDLERS, action);
}

function phoneNumberInfo(value: unknown): WhatsAppPhoneNumberInfo {
    if (!isRecord(value) || !nonEmptyText(value.id)) invalidResponse("号码资料", value);
    const displayPhoneNumber = optionalResponseText(value, "display_phone_number");
    const verifiedName = optionalResponseText(value, "verified_name");
    const qualityRating = qualityRatingValue(value.quality_rating, value);
    const verificationStatus = verificationStatusValue(value.code_verification_status, value);
    const nameStatus = nameStatusValue(value.name_status, value);
    return {
        id: value.id,
        ...(displayPhoneNumber ? { display_phone_number: displayPhoneNumber } : {}),
        ...(verifiedName ? { verified_name: verifiedName } : {}),
        ...(qualityRating ? { quality_rating: qualityRating } : {}),
        ...(verificationStatus ? { code_verification_status: verificationStatus } : {}),
        ...(nameStatus ? { name_status: nameStatus } : {}),
    };
}

function optionalResponseText(source: Record<string, unknown>, name: string): string | undefined {
    const value = source[name];
    if (value === undefined) return undefined;
    if (!nonEmptyText(value)) invalidResponse(`号码资料字段 ${name}`, source);
    return value;
}

function qualityRatingValue(
    value: unknown,
    source: unknown,
): WhatsAppPhoneNumberInfo["quality_rating"] {
    if (value === undefined) return undefined;
    if (value === "GREEN" || value === "YELLOW" || value === "RED" || value === "NA") {
        return value;
    }
    return invalidResponse("号码资料字段 quality_rating", source);
}

function verificationStatusValue(
    value: unknown,
    source: unknown,
): WhatsAppPhoneNumberInfo["code_verification_status"] {
    if (value === undefined) return undefined;
    if (value === "VERIFIED" || value === "UNVERIFIED") return value;
    return invalidResponse("号码资料字段 code_verification_status", source);
}

function nameStatusValue(value: unknown, source: unknown): WhatsAppPhoneNumberInfo["name_status"] {
    if (value === undefined) return undefined;
    if (
        value === "APPROVED" ||
        value === "AVAILABLE_WITHOUT_REVIEW" ||
        value === "DECLINED" ||
        value === "EXPIRED" ||
        value === "PENDING_REVIEW" ||
        value === "NONE"
    ) {
        return value;
    }
    return invalidResponse("号码资料字段 name_status", source);
}

function registrationParams(
    params: Readonly<Record<string, unknown>>,
): WhatsAppPhoneNumberRegistration {
    const backup = optionalRecord(params, "backup");
    if (backup) rejectUnknown(backup, ["password", "data"], "backup");
    return {
        pin: requiredText(params, "pin"),
        ...(backup
            ? {
                  backup: {
                      password: requiredText(backup, "password"),
                      data: requiredText(backup, "data"),
                  },
              }
            : {}),
    };
}

function backupPayload(backup: { password: string; data: string }): {
    password: string;
    data: string;
} {
    return {
        password: nonEmpty(backup.password, "backup.password"),
        data: nonEmpty(backup.data, "backup.data"),
    };
}

function successResponse(value: unknown, operation: string): WhatsAppSuccessResponse {
    if (!isRecord(value) || value.success !== true) invalidResponse(operation, value);
    return { success: true };
}

function actionCodeMethod(
    params: Readonly<Record<string, unknown>>,
): WhatsAppVerificationCodeMethod {
    const value = requiredText(params, "code_method");
    return codeMethod(value);
}

function codeMethod(value: string): WhatsAppVerificationCodeMethod {
    if (value !== "SMS" && value !== "VOICE") invalidParameter("code_method 必须是 SMS 或 VOICE");
    return value;
}

function locale(value: string): string {
    if (!/^[a-z]{2}_[A-Z]{2}$/u.test(value)) {
        invalidParameter("language 必须是 en_US 形式的五字符 locale");
    }
    return value;
}

function sixDigits(value: string, name: string): string {
    if (!/^\d{6}$/u.test(value)) invalidParameter(`${name} 必须是 6 位数字`);
    return value;
}

function nonEmpty(value: string, name: string): string {
    if (!value.trim()) invalidParameter(`${name} 不能为空`);
    return value;
}

function requiredText(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (!nonEmptyText(value)) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function optionalRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Readonly<Record<string, unknown>> | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (!isRecord(value)) invalidParameter(`${name} 必须是对象`);
    return value;
}

function rejectUnknown(
    value: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
    name: string,
): void {
    const unknown = Object.keys(value).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`${name} 包含未知字段: ${unknown}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function invalidResponse(operation: string, details: unknown): never {
    throw new WhatsAppApiError(`WhatsApp ${operation}响应不符合官方结构`, {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
