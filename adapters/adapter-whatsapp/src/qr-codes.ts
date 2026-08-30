import type { PlatformActionHandler } from "onebots";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export const WHATSAPP_QR_CODE_FIELDS = Object.freeze([
    "code",
    "prefilled_message",
    "deep_link_url",
    "creation_time",
] as const);
export type WhatsAppQrCodeField = (typeof WHATSAPP_QR_CODE_FIELDS)[number];

export const WHATSAPP_QR_IMAGE_FORMATS = Object.freeze(["PNG", "SVG"] as const);
export type WhatsAppQrImageFormat = (typeof WHATSAPP_QR_IMAGE_FORMATS)[number];

export interface WhatsAppQrCodeDetails {
    code?: string;
    prefilled_message?: string;
    deep_link_url?: string;
    creation_time?: number;
    qr_image_url?: string;
}

export interface WhatsAppQrCode extends WhatsAppQrCodeDetails {
    code: string;
    prefilled_message: string;
    deep_link_url: string;
}

export interface WhatsAppQrCodeFieldSelection {
    fields?: readonly WhatsAppQrCodeField[];
    qr_image_format?: WhatsAppQrImageFormat;
}

export interface WhatsAppQrCodeListQuery extends WhatsAppQrCodeFieldSelection {
    code?: string;
    limit?: number;
    after?: string;
}

export interface WhatsAppQrCodePaging {
    cursors?: {
        before?: string;
        after?: string;
    };
    previous?: string;
    next?: string;
}

export interface WhatsAppQrCodeListResponse {
    data: WhatsAppQrCodeDetails[];
    paging?: WhatsAppQrCodePaging;
}

export interface WhatsAppQrCodeGetResponse {
    data: [WhatsAppQrCodeDetails];
}

export interface WhatsAppQrCodeCreate {
    prefilled_message: string;
    generate_qr_image?: WhatsAppQrImageFormat;
}

export interface WhatsAppQrCodeUpdate {
    code: string;
    prefilled_message: string;
}

export interface WhatsAppQrCodeMutationResponse extends WhatsAppQrCode {
    qr_image_url?: string;
}

export interface WhatsAppQrCodeDeleteResponse {
    success: true;
}

export const WHATSAPP_QR_CODE_ACTIONS = Object.freeze([
    "list_qr_codes",
    "get_qr_code",
    "create_qr_code",
    "update_qr_code",
    "delete_qr_code",
] as const);
export type WhatsAppQrCodeAction = (typeof WHATSAPP_QR_CODE_ACTIONS)[number];

export function isWhatsAppQrCodeAction(action: string): action is WhatsAppQrCodeAction {
    return (WHATSAPP_QR_CODE_ACTIONS as readonly string[]).includes(action);
}

/** Phone Number 级消息二维码管理，严格映射 Meta v23 message_qrdls 资源。 */
export class WhatsAppQrCodes {
    constructor(private readonly client: WhatsAppClient) {}

    async list(query: WhatsAppQrCodeListQuery = {}): Promise<WhatsAppQrCodeListResponse> {
        const normalized = listQuery(query);
        const response = await this.client.call<unknown>({
            resource: `${this.client.config.phone_number_id}/message_qrdls`,
            query: normalized,
        });
        return listResponse(response);
    }

    async get(
        code: string,
        selection: WhatsAppQrCodeFieldSelection = {},
    ): Promise<WhatsAppQrCodeGetResponse> {
        const response = await this.client.call<unknown>({
            resource: `${this.client.config.phone_number_id}/message_qrdls/${qrCode(code)}`,
            query: fieldQuery(selection),
        });
        return getResponse(response);
    }

    async create(request: WhatsAppQrCodeCreate): Promise<WhatsAppQrCodeMutationResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/message_qrdls`,
            body: createRequest(request),
        });
        return mutationResponse(response);
    }

    async update(request: WhatsAppQrCodeUpdate): Promise<WhatsAppQrCodeMutationResponse> {
        const response = await this.client.call<unknown>({
            method: "POST",
            resource: `${this.client.config.phone_number_id}/message_qrdls`,
            body: updateRequest(request),
        });
        return mutationResponse(response);
    }

    async delete(code: string): Promise<WhatsAppQrCodeDeleteResponse> {
        const response = await this.client.call<unknown>({
            method: "DELETE",
            resource: `${this.client.config.phone_number_id}/message_qrdls/${qrCode(code)}`,
        });
        if (!isRecord(response) || response.success !== true) invalidResponse(response);
        return { success: true };
    }

    execute(
        action: WhatsAppQrCodeAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "list_qr_codes":
                return this.list(actionListQuery(params));
            case "get_qr_code":
                rejectUnknown(params, ["code", "fields", "qr_image_format"]);
                return this.get(qrCode(params.code), actionSelection(params));
            case "create_qr_code":
                return this.create(actionCreate(params));
            case "update_qr_code":
                return this.update(actionUpdate(params));
            case "delete_qr_code":
                rejectUnknown(params, ["code"]);
                return this.delete(qrCode(params.code));
        }
    }
}

export const WHATSAPP_QR_CODE_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_QR_CODE_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.qrCodes.execute(action, params),
    ]),
) as Record<WhatsAppQrCodeAction, PlatformActionHandler<WhatsAppClient>>;

function actionListQuery(params: Readonly<Record<string, unknown>>): WhatsAppQrCodeListQuery {
    rejectUnknown(params, ["code", "fields", "qr_image_format", "limit", "after"]);
    return {
        ...actionSelection(params),
        ...(params.code === undefined ? {} : { code: qrCode(params.code) }),
        ...(params.limit === undefined ? {} : { limit: limit(params.limit) }),
        ...(params.after === undefined ? {} : { after: nonemptyString(params.after, "after") }),
    };
}

function actionSelection(params: Readonly<Record<string, unknown>>): WhatsAppQrCodeFieldSelection {
    return {
        ...(params.fields === undefined ? {} : { fields: fields(params.fields) }),
        ...(params.qr_image_format === undefined
            ? {}
            : { qr_image_format: imageFormat(params.qr_image_format, "qr_image_format") }),
    };
}

function actionCreate(params: Readonly<Record<string, unknown>>): WhatsAppQrCodeCreate {
    rejectUnknown(params, ["prefilled_message", "generate_qr_image"]);
    return createRequest(params);
}

function actionUpdate(params: Readonly<Record<string, unknown>>): WhatsAppQrCodeUpdate {
    rejectUnknown(params, ["code", "prefilled_message"]);
    return updateRequest(params);
}

function listQuery(value: unknown): Record<string, string | number> {
    if (!isRecord(value)) invalidParameter("QR Code 查询必须是对象");
    rejectUnknown(value, ["code", "fields", "qr_image_format", "limit", "after"]);
    return {
        ...fieldQuery(value, ["code", "limit", "after"]),
        ...(value.code === undefined ? {} : { code: qrCode(value.code) }),
        ...(value.limit === undefined ? {} : { limit: limit(value.limit) }),
        ...(value.after === undefined ? {} : { after: nonemptyString(value.after, "after") }),
    };
}

function fieldQuery(value: unknown, additional: readonly string[] = []): Record<string, string> {
    if (!isRecord(value)) invalidParameter("QR Code 字段选择必须是对象");
    rejectUnknown(value, ["fields", "qr_image_format", ...additional]);
    const selected =
        value.fields === undefined ? [...WHATSAPP_QR_CODE_FIELDS] : fields(value.fields);
    const format =
        value.qr_image_format === undefined
            ? undefined
            : imageFormat(value.qr_image_format, "qr_image_format");
    return {
        fields: [...selected, ...(format ? [`qr_image_url.format(${format})`] : [])].join(","),
    };
}

function fields(value: unknown): WhatsAppQrCodeField[] {
    if (!Array.isArray(value)) invalidParameter("fields 必须是可增减的字段数组");
    if (!value.length) invalidParameter("QR Code fields 不能为空");
    return [...new Set(value.map(field))];
}

function field(value: unknown): WhatsAppQrCodeField {
    if (!isQrCodeField(value)) {
        invalidParameter(`未知 QR Code 字段: ${String(value)}`);
    }
    return value;
}

function isQrCodeField(value: unknown): value is WhatsAppQrCodeField {
    return (
        typeof value === "string" && (WHATSAPP_QR_CODE_FIELDS as readonly string[]).includes(value)
    );
}

function createRequest(value: unknown): WhatsAppQrCodeCreate {
    if (!isRecord(value)) invalidParameter("QR Code 创建参数必须是对象");
    rejectUnknown(value, ["prefilled_message", "generate_qr_image"]);
    return {
        prefilled_message: prefilledMessage(value.prefilled_message),
        ...(value.generate_qr_image === undefined
            ? {}
            : { generate_qr_image: imageFormat(value.generate_qr_image, "generate_qr_image") }),
    };
}

function updateRequest(value: unknown): WhatsAppQrCodeUpdate {
    if (!isRecord(value)) invalidParameter("QR Code 更新参数必须是对象");
    rejectUnknown(value, ["code", "prefilled_message"]);
    return {
        code: qrCode(value.code),
        prefilled_message: prefilledMessage(value.prefilled_message),
    };
}

function listResponse(value: unknown): WhatsAppQrCodeListResponse {
    if (!isRecord(value) || !Array.isArray(value.data)) invalidResponse(value);
    return {
        data: value.data.map(details),
        ...(value.paging === undefined ? {} : { paging: paging(value.paging, value) }),
    };
}

function getResponse(value: unknown): WhatsAppQrCodeGetResponse {
    if (!isRecord(value) || !Array.isArray(value.data) || value.data.length !== 1) {
        invalidResponse(value);
    }
    return { data: [details(value.data[0])] };
}

function mutationResponse(value: unknown): WhatsAppQrCodeMutationResponse {
    const item = completeDetails(value);
    return {
        code: item.code,
        prefilled_message: item.prefilled_message,
        deep_link_url: item.deep_link_url,
        ...(item.qr_image_url === undefined ? {} : { qr_image_url: item.qr_image_url }),
    };
}

function details(value: unknown): WhatsAppQrCodeDetails {
    if (!isRecord(value)) invalidResponse(value);
    if (
        !["code", "prefilled_message", "deep_link_url", "creation_time", "qr_image_url"].some(
            name => value[name] !== undefined,
        )
    ) {
        invalidResponse(value);
    }
    return {
        ...(value.code === undefined ? {} : { code: responseQrCode(value.code, value) }),
        ...(value.prefilled_message === undefined
            ? {}
            : { prefilled_message: responseString(value.prefilled_message, value) }),
        ...(value.deep_link_url === undefined
            ? {}
            : { deep_link_url: responseUrl(value.deep_link_url, value) }),
        ...(value.creation_time === undefined
            ? {}
            : { creation_time: responseTimestamp(value.creation_time, value) }),
        ...(value.qr_image_url === undefined
            ? {}
            : { qr_image_url: responseUrl(value.qr_image_url, value) }),
    };
}

function completeDetails(value: unknown): WhatsAppQrCode {
    const item = details(value);
    if (!item.code || !item.prefilled_message || !item.deep_link_url) invalidResponse(value);
    return {
        ...item,
        code: item.code,
        prefilled_message: item.prefilled_message,
        deep_link_url: item.deep_link_url,
    };
}

function paging(value: unknown, root: unknown): WhatsAppQrCodePaging {
    if (!isRecord(value)) invalidResponse(root);
    const cursors = value.cursors === undefined ? undefined : pagingCursors(value.cursors, root);
    return {
        ...(cursors ? { cursors } : {}),
        ...(value.previous === undefined ? {} : { previous: responseUrl(value.previous, root) }),
        ...(value.next === undefined ? {} : { next: responseUrl(value.next, root) }),
    };
}

function pagingCursors(value: unknown, root: unknown): WhatsAppQrCodePaging["cursors"] {
    if (!isRecord(value)) invalidResponse(root);
    return {
        ...(value.before === undefined ? {} : { before: responseString(value.before, root) }),
        ...(value.after === undefined ? {} : { after: responseString(value.after, root) }),
    };
}

function qrCode(value: unknown): string {
    const code = nonemptyString(value, "code");
    // Meta v23 OpenAPI 的 Base32 pattern 排除 1，但 Message Qrdls 官方示例均包含 1；
    // 这里按该端点真实返回的大写字母数字路径标识约束，避免误拒绝有效 code。
    if (!/^[A-Z\d]{14}$/u.test(code)) {
        invalidParameter("code 必须是 14 位大写字母数字 QR Code 标识");
    }
    return code;
}

function prefilledMessage(value: unknown): string {
    const message = nonemptyString(value, "prefilled_message");
    if (message.length > 140) invalidParameter("prefilled_message 不能超过 140 个字符");
    return message;
}

function limit(value: unknown): number {
    if (!Number.isInteger(value) || typeof value !== "number" || value < 1 || value > 25) {
        invalidParameter("limit 必须是 1 到 25 的整数");
    }
    return value;
}

function imageFormat(value: unknown, name: string): WhatsAppQrImageFormat {
    if (!isQrImageFormat(value)) {
        invalidParameter(`${name} 仅支持 PNG 或 SVG`);
    }
    return value;
}

function isQrImageFormat(value: unknown): value is WhatsAppQrImageFormat {
    return (
        typeof value === "string" &&
        (WHATSAPP_QR_IMAGE_FORMATS as readonly string[]).includes(value)
    );
}

function responseQrCode(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !/^[A-Z\d]{14}$/u.test(value)) invalidResponse(root);
    return value;
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function responseTimestamp(value: unknown, root: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
        invalidResponse(root);
    return value;
}

function responseUrl(value: unknown, root: unknown): string {
    const text = responseString(value, root);
    if (!URL.canParse(text)) invalidResponse(root);
    const url = new URL(text);
    if (url.protocol !== "https:" && url.protocol !== "http:") invalidResponse(root);
    return text;
}

function nonemptyString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function rejectUnknown(source: Record<string, unknown>, allowed: readonly string[]): void {
    const unknown = Object.keys(source).find(name => !allowed.includes(name));
    if (unknown) invalidParameter(`QR Code 参数包含未知字段: ${unknown}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp QR Code 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
