import { materializeMediaSource, type PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppClient } from "./client.js";
import { validateGroupProfilePicture } from "./group-profile-picture.js";
import {
    parseGroupInviteLinkResponse,
    parseGroupJoinRequestActionResponse,
    parseGroupOperationResponse,
    parseGroupSuccessResponse,
    parseGroupDetails,
    parseGroupJoinRequestsResponse,
    parseGroupListResponse,
} from "./group-responses.js";
import type {
    WhatsAppAPIResponse,
    WhatsAppGroupCreateParams,
    WhatsAppGroupDetails,
    WhatsAppGroupInviteLinkResponse,
    WhatsAppGroupJoinRequestActionResponse,
    WhatsAppGroupJoinRequestsResponse,
    WhatsAppGroupListResponse,
    WhatsAppGroupOperationResponse,
    WhatsAppGroupPagination,
    WhatsAppGroupSummary,
    WhatsAppGroupSuccessResponse,
    WhatsAppGroupUpdateParams,
} from "./types.js";

const GROUP_FIELDS = [
    "join_approval_mode",
    "subject",
    "description",
    "suspended",
    "creation_timestamp",
    "participants",
    "total_participant_count",
] as const;

/**
 * WhatsApp Groups API 深模块。
 *
 * Graph 路径、产品字段、分页和参数约束都收敛在此；Adapter 与平台动作只消费
 * 已验证的领域操作，避免两套入口分别复制 Meta 语义。
 */
export class WhatsAppGroups {
    constructor(private readonly client: WhatsAppClient) {}

    async create(params: WhatsAppGroupCreateParams): Promise<WhatsAppGroupOperationResponse> {
        const normalized = createParams(params);
        return parseGroupOperationResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/groups`,
                body: compact({ messaging_product: "whatsapp", ...normalized }),
            }),
        );
    }

    async get(groupId: string): Promise<WhatsAppGroupDetails> {
        return parseGroupDetails(
            await this.client.call<unknown>({
                resource: resourceId(groupId, "group_id"),
                query: { fields: GROUP_FIELDS.join(",") },
            }),
        );
    }

    async list(params: WhatsAppGroupPagination = {}): Promise<WhatsAppGroupListResponse> {
        return parseGroupListResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/groups`,
                query: { ...paginationParams(params) },
            }),
        );
    }

    async listAll(): Promise<WhatsAppGroupSummary[]> {
        const groups: WhatsAppGroupSummary[] = [];
        const seenCursors = new Set<string>();
        let after: string | undefined;
        do {
            const page = await this.list(after ? { after } : {});
            groups.push(...page.data.groups);
            const next = page.paging?.cursors?.after;
            if (next && seenCursors.has(next)) {
                throw new WhatsAppApiError("WhatsApp 群列表分页 cursor 重复，无法确认结果完整", {
                    code: "WHATSAPP_INVALID_RESPONSE",
                });
            }
            after = next;
            if (after) seenCursors.add(after);
        } while (after);
        return groups;
    }

    async update(
        groupId: string,
        params: WhatsAppGroupUpdateParams,
    ): Promise<WhatsAppGroupOperationResponse> {
        const { subject, description, profile_picture: profilePicture } = updateParams(params);
        if (subject === undefined && description === undefined && profilePicture === undefined) {
            invalidParameter("更新群设置至少需要 subject、description 或 profile_picture");
        }
        const resource = resourceId(groupId, "group_id");
        if (!profilePicture) {
            return parseGroupOperationResponse(
                await this.client.call<unknown>({
                    method: "POST",
                    resource,
                    body: compact({ messaging_product: "whatsapp", subject, description }),
                }),
            );
        }
        const media = await materializeMediaSource({ source: profilePicture });
        validateGroupProfilePicture(media.data, media.contentType);
        const form = new FormData();
        form.set("messaging_product", "whatsapp");
        if (subject !== undefined) form.set("subject", subject);
        if (description !== undefined) form.set("description", description);
        form.set(
            "file",
            new Blob([Uint8Array.from(media.data)], { type: media.contentType }),
            media.filename,
        );
        return parseGroupOperationResponse(
            await this.client.call<unknown>({ method: "POST", resource, body: form }),
        );
    }

    async delete(groupId: string): Promise<WhatsAppGroupSuccessResponse> {
        return parseGroupSuccessResponse(
            await this.client.call<unknown>({
                method: "DELETE",
                resource: resourceId(groupId, "group_id"),
            }),
        );
    }

    async getInviteLink(groupId: string): Promise<WhatsAppGroupInviteLinkResponse> {
        return parseGroupInviteLinkResponse(
            await this.client.call<unknown>({
                resource: `${resourceId(groupId, "group_id")}/invite_link`,
            }),
        );
    }

    async resetInviteLink(groupId: string): Promise<WhatsAppGroupInviteLinkResponse> {
        return parseGroupInviteLinkResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${resourceId(groupId, "group_id")}/invite_link`,
                body: { messaging_product: "whatsapp" },
            }),
        );
    }

    async listJoinRequests(
        groupId: string,
        params: WhatsAppGroupPagination = {},
    ): Promise<WhatsAppGroupJoinRequestsResponse> {
        return parseGroupJoinRequestsResponse(
            await this.client.call<unknown>({
                resource: `${resourceId(groupId, "group_id")}/join_requests`,
                query: { ...paginationParams(params) },
            }),
        );
    }

    async approveJoinRequests(
        groupId: string,
        requestIds: readonly string[],
    ): Promise<WhatsAppGroupJoinRequestActionResponse> {
        return this.joinRequestAction("POST", groupId, requestIds);
    }

    async rejectJoinRequests(
        groupId: string,
        requestIds: readonly string[],
    ): Promise<WhatsAppGroupJoinRequestActionResponse> {
        return this.joinRequestAction("DELETE", groupId, requestIds);
    }

    async removeParticipants(
        groupId: string,
        participants: readonly string[],
    ): Promise<WhatsAppGroupOperationResponse> {
        return this.participantAction(
            "DELETE",
            groupId,
            participants.map(user => ({ user })),
        );
    }

    async pinMessage(
        groupId: string,
        messageId: string,
        expirationDays: number,
    ): Promise<WhatsAppAPIResponse> {
        if (!Number.isInteger(expirationDays) || expirationDays < 1 || expirationDays > 30) {
            invalidParameter("expiration_days 必须是 1-30 的整数");
        }
        return this.client.sendMessage({
            to: resourceId(groupId, "group_id"),
            recipient_type: "group",
            type: "pin",
            pin: {
                type: "pin",
                message_id: opaqueId(messageId, "message_id"),
                expiration_days: expirationDays,
            },
        });
    }

    async unpinMessage(groupId: string, messageId: string): Promise<WhatsAppAPIResponse> {
        return this.client.sendMessage({
            to: resourceId(groupId, "group_id"),
            recipient_type: "group",
            type: "pin",
            pin: { type: "unpin", message_id: opaqueId(messageId, "message_id") },
        });
    }

    private joinRequestAction(
        method: "POST" | "DELETE",
        groupId: string,
        requestIds: readonly string[],
    ): Promise<WhatsAppGroupJoinRequestActionResponse> {
        if (!requestIds.length) invalidParameter("request_ids 不能为空");
        return this.joinRequestOperation({
            method,
            resource: `${resourceId(groupId, "group_id")}/join_requests`,
            body: { messaging_product: "whatsapp", join_requests: [...requestIds] },
        });
    }

    private participantAction(
        method: "POST" | "DELETE",
        groupId: string,
        participants: ReadonlyArray<Record<string, string>>,
    ): Promise<WhatsAppGroupOperationResponse> {
        if (!participants.length) invalidParameter("参与者列表不能为空");
        if (participants.length > 8) invalidParameter("单次参与者操作最多 8 人");
        return this.operation({
            method,
            resource: `${resourceId(groupId, "group_id")}/participants`,
            body: { messaging_product: "whatsapp", participants },
        });
    }

    private async operation(options: {
        method: "POST" | "DELETE";
        resource: string;
        body: unknown;
    }): Promise<WhatsAppGroupOperationResponse> {
        return parseGroupOperationResponse(await this.client.call<unknown>(options));
    }

    private async joinRequestOperation(options: {
        method: "POST" | "DELETE";
        resource: string;
        body: unknown;
    }): Promise<WhatsAppGroupJoinRequestActionResponse> {
        return parseGroupJoinRequestActionResponse(await this.client.call<unknown>(options));
    }
}

type GroupActionParams = Readonly<Record<string, unknown>>;

const GROUP_ACTION_HANDLERS = {
    create_group: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.create(createParams(params)),
    get_group: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.get(requiredResourceId(params, "group_id")),
    list_groups: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.list(paginationParams(params)),
    update_group: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.update(requiredResourceId(params, "group_id"), updateParams(params)),
    delete_group: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.delete(requiredResourceId(params, "group_id")),
    get_group_invite_link: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.getInviteLink(requiredResourceId(params, "group_id")),
    reset_group_invite_link: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.resetInviteLink(requiredResourceId(params, "group_id")),
    list_group_join_requests: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.listJoinRequests(
            requiredResourceId(params, "group_id"),
            paginationParams(params),
        ),
    approve_group_join_requests: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.approveJoinRequests(
            requiredResourceId(params, "group_id"),
            stringArray(params, "request_ids"),
        ),
    reject_group_join_requests: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.rejectJoinRequests(
            requiredResourceId(params, "group_id"),
            stringArray(params, "request_ids"),
        ),
    remove_group_participants: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.removeParticipants(
            requiredResourceId(params, "group_id"),
            stringArray(params, "user_ids"),
        ),
    pin_message: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.pinMessage(
            requiredResourceId(params, "group_id"),
            requiredOpaqueId(params, "message_id"),
            requiredInteger(params, "expiration_days"),
        ),
    unpin_message: (client: WhatsAppClient, params: GroupActionParams) =>
        client.groups.unpinMessage(
            requiredResourceId(params, "group_id"),
            requiredOpaqueId(params, "message_id"),
        ),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Groups 动作的执行与参数契约单一来源。 */
export const WHATSAPP_GROUP_ACTION_HANDLERS = defineWhatsAppActionHandlers(GROUP_ACTION_HANDLERS, {
    create_group: ["subject", "description", "join_approval_mode"],
    get_group: ["group_id"],
    list_groups: ["limit", "after", "before"],
    update_group: ["group_id", "subject", "description", "profile_picture"],
    delete_group: ["group_id"],
    get_group_invite_link: ["group_id"],
    reset_group_invite_link: ["group_id"],
    list_group_join_requests: ["group_id", "limit", "after", "before"],
    approve_group_join_requests: ["group_id", "request_ids"],
    reject_group_join_requests: ["group_id", "request_ids"],
    remove_group_participants: ["group_id", "user_ids"],
    pin_message: ["group_id", "message_id", "expiration_days"],
    unpin_message: ["group_id", "message_id"],
});

export type WhatsAppGroupAction = keyof typeof WHATSAPP_GROUP_ACTION_HANDLERS;

export function isWhatsAppGroupAction(action: string): action is WhatsAppGroupAction {
    return Object.hasOwn(WHATSAPP_GROUP_ACTION_HANDLERS, action);
}

function paginationParams(params: object): WhatsAppGroupPagination {
    const limit = optionalInteger(params, "limit");
    if (limit !== undefined && (limit <= 0 || limit > 1024)) {
        invalidParameter("limit 必须是 1-1024 的整数");
    }
    return {
        limit,
        after: optionalString(params, "after"),
        before: optionalString(params, "before"),
    };
}

function createParams(params: object): WhatsAppGroupCreateParams {
    return compact({
        subject: boundedString(params, "subject", 128),
        description: optionalBoundedString(params, "description", 2048),
        join_approval_mode: optionalEnum(params, "join_approval_mode", [
            "auto_approve",
            "approval_required",
        ] as const),
    });
}

function updateParams(params: object): WhatsAppGroupUpdateParams {
    return compact({
        subject: optionalBoundedString(params, "subject", 128),
        description: optionalBoundedString(params, "description", 2048, true),
        profile_picture: optionalString(params, "profile_picture"),
    });
}

function stringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (!Array.isArray(value) || !value.length) invalidParameter(`${name} 必须是非空字符串数组`);
    return value.map(item => {
        if (typeof item !== "string" || !item) invalidParameter(`${name} 必须是非空字符串数组`);
        return opaqueId(item, name);
    });
}

function boundedString(params: object, name: string, max: number): string {
    const value = readField(params, name);
    if (typeof value !== "string" || !value.trim() || value.length > max) {
        invalidParameter(`${name} 必须是 1-${max} 个字符`);
    }
    return value;
}

function optionalBoundedString(
    params: object,
    name: string,
    max: number,
    allowEmpty = false,
): string | undefined {
    const value = readField(params, name);
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.length > max || (!allowEmpty && !value.trim())) {
        invalidParameter(`${name} 必须是${allowEmpty ? `不超过 ${max}` : `1-${max}`} 个字符`);
    }
    return value;
}

function optionalEnum<const T extends readonly string[]>(
    params: object,
    name: string,
    values: T,
): T[number] | undefined {
    const value = readField(params, name);
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !values.includes(value)) {
        invalidParameter(`${name} 必须是 ${values.join("/")}`);
    }
    return value as T[number];
}

function optionalString(params: object, name: string): string | undefined {
    const value = readField(params, name);
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value) invalidParameter(`${name} 必须是非空字符串`);
    return value;
}

function optionalInteger(params: object, name: string): number | undefined {
    const value = Reflect.get(params, name) as unknown;
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isInteger(value))
        invalidParameter(`${name} 必须是整数`);
    return value;
}

function readField(params: object, name: string): unknown {
    return Reflect.get(params, name) as unknown;
}

function requiredInteger(params: Readonly<Record<string, unknown>>, name: string): number {
    const value = optionalInteger(params, name);
    if (value === undefined) invalidParameter(`${name} 必须是整数`);
    return value;
}

function requiredResourceId(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = optionalString(params, name);
    if (!value) invalidParameter(`${name} 必须是非空字符串`);
    return resourceId(value, name);
}

function requiredOpaqueId(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = optionalString(params, name);
    if (!value) invalidParameter(`${name} 必须是非空字符串`);
    return opaqueId(value, name);
}

function resourceId(value: string, name: string): string {
    if (!/^[A-Za-z\d@._:-]+$/u.test(value)) invalidParameter(`${name} 必须是单段 Graph 资源 ID`);
    return value;
}

function opaqueId(value: string, name: string): string {
    if (!value || /[\u0000-\u001f\u007f]/u.test(value)) {
        invalidParameter(`${name} 必须是有效非空标识`);
    }
    return value;
}

function compact<T extends Record<string, unknown>>(value: T): T {
    return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
