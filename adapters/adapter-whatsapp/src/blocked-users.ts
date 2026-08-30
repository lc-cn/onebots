import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";

export interface WhatsAppBlockedUser {
    messaging_product: "whatsapp";
    wa_id: string;
}

export interface WhatsAppBlockedUserPaging {
    cursors?: { before?: string; after?: string };
    previous?: string;
    next?: string;
}

export interface WhatsAppBlockedUserListQuery {
    limit?: number;
    after?: string;
}

export interface WhatsAppBlockedUserListResponse {
    data: WhatsAppBlockedUser[];
    paging?: WhatsAppBlockedUserPaging;
}

export interface WhatsAppBlockedUserOperation {
    input: string;
    wa_id: string;
}

export interface WhatsAppBlockUsersResponse {
    messaging_product: "whatsapp";
    block_users: { added_users: WhatsAppBlockedUserOperation[] };
}

export interface WhatsAppUnblockUsersResponse {
    messaging_product: "whatsapp";
    block_users: { removed_users: WhatsAppBlockedUserOperation[] };
}

/** Phone Number 级批量封禁控制面，保留 Meta 对输入号码的规范化结果。 */
export class WhatsAppBlockedUsers {
    constructor(private readonly client: WhatsAppClient) {}

    async list(query: WhatsAppBlockedUserListQuery = {}): Promise<WhatsAppBlockedUserListResponse> {
        return listResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/block_users`,
                query: listQuery(query),
            }),
        );
    }

    async block(users: readonly string[]): Promise<WhatsAppBlockUsersResponse> {
        return blockResponse(await this.mutate("POST", users));
    }

    async unblock(users: readonly string[]): Promise<WhatsAppUnblockUsersResponse> {
        return unblockResponse(await this.mutate("DELETE", users));
    }

    private mutate(method: "POST" | "DELETE", users: readonly string[]): Promise<unknown> {
        return this.client.call<unknown>({
            method,
            resource: `${this.client.config.phone_number_id}/block_users`,
            body: {
                messaging_product: "whatsapp",
                block_users: userList(users).map(user => ({ user })),
            },
        });
    }
}

type BlockedUserActionParams = Readonly<Record<string, unknown>>;

const BLOCKED_USER_ACTION_HANDLERS = {
    list_blocked_users: (client: WhatsAppClient, params: BlockedUserActionParams) =>
        client.blockedUsers.list({
            ...(params.limit === undefined ? {} : { limit: pageLimit(params.limit) }),
            ...(params.after === undefined ? {} : { after: nonemptyString(params.after, "after") }),
        }),
    block_users: (client: WhatsAppClient, params: BlockedUserActionParams) =>
        client.blockedUsers.block(userList(params.users)),
    unblock_users: (client: WhatsAppClient, params: BlockedUserActionParams) =>
        client.blockedUsers.unblock(userList(params.users)),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Blocked Users 动作的执行与参数契约单一来源。 */
export const WHATSAPP_BLOCKED_USER_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    BLOCKED_USER_ACTION_HANDLERS,
    {
        list_blocked_users: ["limit", "after"],
        block_users: ["users"],
        unblock_users: ["users"],
    },
);

export type WhatsAppBlockedUserAction = keyof typeof WHATSAPP_BLOCKED_USER_ACTION_HANDLERS;

export function isWhatsAppBlockedUserAction(action: string): action is WhatsAppBlockedUserAction {
    return Object.hasOwn(WHATSAPP_BLOCKED_USER_ACTION_HANDLERS, action);
}

function listQuery(value: unknown): Record<string, string | number> {
    const source = inputRecord(value, "Blocked User 查询");
    rejectUnknown(source, ["limit", "after"]);
    return {
        ...(source.limit === undefined ? {} : { limit: pageLimit(source.limit) }),
        ...(source.after === undefined ? {} : { after: nonemptyString(source.after, "after") }),
    };
}

function listResponse(value: unknown): WhatsAppBlockedUserListResponse {
    const source = responseRecord(value, value);
    if (!Array.isArray(source.data)) invalidResponse(value);
    return {
        data: source.data.map(item => {
            const user = responseRecord(item, value);
            if (user.messaging_product !== "whatsapp") invalidResponse(value);
            return {
                messaging_product: "whatsapp",
                wa_id: responseWaId(user.wa_id, value),
            };
        }),
        ...(source.paging === undefined ? {} : { paging: paging(source.paging, value) }),
    };
}

function blockResponse(value: unknown): WhatsAppBlockUsersResponse {
    const source = mutationEnvelope(value);
    const result = responseRecord(source.block_users, value);
    return {
        messaging_product: "whatsapp",
        block_users: { added_users: operations(result.added_users, value) },
    };
}

function unblockResponse(value: unknown): WhatsAppUnblockUsersResponse {
    const source = mutationEnvelope(value);
    const result = responseRecord(source.block_users, value);
    return {
        messaging_product: "whatsapp",
        block_users: { removed_users: operations(result.removed_users, value) },
    };
}

function mutationEnvelope(value: unknown): Record<string, unknown> {
    const source = responseRecord(value, value);
    if (source.messaging_product !== "whatsapp") invalidResponse(value);
    return source;
}

function operations(value: unknown, root: unknown): WhatsAppBlockedUserOperation[] {
    if (!Array.isArray(value)) invalidResponse(root);
    return value.map(item => {
        const operation = responseRecord(item, root);
        return {
            input: e164(operation.input, "响应 input", () => invalidResponse(root)),
            wa_id: responseWaId(operation.wa_id, root),
        };
    });
}

function paging(value: unknown, root: unknown): WhatsAppBlockedUserPaging {
    const source = responseRecord(value, root);
    const result: WhatsAppBlockedUserPaging = {};
    if (source.cursors !== undefined) {
        const cursors = responseRecord(source.cursors, root);
        result.cursors = {
            ...(cursors.before === undefined
                ? {}
                : { before: responseString(cursors.before, root) }),
            ...(cursors.after === undefined ? {} : { after: responseString(cursors.after, root) }),
        };
    }
    if (source.previous !== undefined) result.previous = responseUrl(source.previous, root);
    if (source.next !== undefined) result.next = responseUrl(source.next, root);
    return result;
}

function userList(value: unknown): string[] {
    if (!Array.isArray(value) || !value.length) invalidParameter("users 必须是非空数组");
    return [...new Set(value.map(user => e164(user, "users", invalidParameter)))];
}

function e164(value: unknown, name: string, fail: (message: string) => never): string {
    if (typeof value !== "string" || !/^\+[1-9]\d{6,14}$/u.test(value)) {
        fail(`${name} 必须是 E.164 号码`);
    }
    return value;
}

function responseWaId(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !/^[1-9]\d{6,14}$/u.test(value)) invalidResponse(root);
    return value;
}

function pageLimit(value: unknown): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
        invalidParameter("limit 必须是正整数");
    }
    return value;
}

function nonemptyString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function responseString(value: unknown, root: unknown): string {
    if (typeof value !== "string" || !value) invalidResponse(root);
    return value;
}

function responseUrl(value: unknown, root: unknown): string {
    const text = responseString(value, root);
    if (!URL.canParse(text) || !["https:", "http:"].includes(new URL(text).protocol))
        invalidResponse(root);
    return text;
}

function inputRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) invalidParameter(`${name}必须是对象`);
    return value;
}

function responseRecord(value: unknown, root: unknown): Record<string, unknown> {
    if (!isRecord(value)) invalidResponse(root);
    return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectUnknown(
    source: Readonly<Record<string, unknown>>,
    allowed: readonly string[],
): void {
    const unknown = Object.keys(source).find(key => !allowed.includes(key));
    if (unknown) invalidParameter(`Blocked User 参数包含未知字段: ${unknown}`);
}

function invalidResponse(details: unknown): never {
    throw new WhatsAppApiError("WhatsApp Blocked User 响应不符合官方结构", {
        code: "WHATSAPP_INVALID_RESPONSE",
        details,
    });
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
