import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppGroupDetails,
    WhatsAppGroupJoinRequest,
    WhatsAppGroupJoinRequestsResponse,
    WhatsAppGroupInviteLinkResponse,
    WhatsAppGroupInviteLinkDeletedResponse,
    WhatsAppGroupJoinRequestActionResponse,
    WhatsAppGroupListResponse,
    WhatsAppGroupOperationResponse,
    WhatsAppGroupSuccessResponse,
    WhatsAppGroupParticipant,
    WhatsAppPaging,
} from "./types.js";

export function parseGroupOperationResponse(value: unknown): WhatsAppGroupOperationResponse {
    const record = requireRecord(value, "群操作响应");
    return { request_id: requireString(record.request_id, "群操作响应 request_id") };
}

export function parseGroupInviteLinkResponse(value: unknown): WhatsAppGroupInviteLinkResponse {
    const record = requireRecord(value, "群邀请链接响应");
    return { invite_link: requireString(record.invite_link, "群邀请链接响应 invite_link") };
}

export function parseGroupSuccessResponse(value: unknown): WhatsAppGroupSuccessResponse {
    const record = requireRecord(value, "群成功响应");
    if (record.success !== true) invalidResponse("群成功响应 success 必须为 true");
    return { success: true };
}

export function parseGroupInviteLinkDeletedResponse(
    value: unknown,
): WhatsAppGroupInviteLinkDeletedResponse {
    const record = requireRecord(value, "群邀请链接删除响应");
    if (record.success !== "true") invalidResponse('群邀请链接删除响应 success 必须为 "true"');
    return { success: "true" };
}

export function parseGroupJoinRequestActionResponse(
    value: unknown,
): WhatsAppGroupJoinRequestActionResponse {
    const record = requireRecord(value, "入群申请操作响应");
    const approved = optionalStringArray(record.approved_join_requests, "approved_join_requests");
    const rejected = optionalStringArray(record.rejected_join_requests, "rejected_join_requests");
    const failed = optionalArray(record.failed_join_requests, "failed_join_requests", value => {
        const failure = requireRecord(value, "失败入群申请");
        return {
            join_request_id: requireString(failure.join_request_id, "失败入群申请 join_request_id"),
            errors: requireArray(failure.errors, "失败入群申请 errors", parseWebhookError),
        };
    });
    const errors = optionalArray(record.errors, "入群申请操作 errors", parseWebhookError);
    if (!approved && !rejected && !failed) {
        invalidResponse("入群申请操作响应缺少结果列表");
    }
    return {
        ...record,
        approved_join_requests: approved,
        rejected_join_requests: rejected,
        failed_join_requests: failed,
        errors,
    };
}

export function parseGroupDetails(value: unknown): WhatsAppGroupDetails {
    const record = requireRecord(value, "群资料");
    const id = requireString(record.id, "群资料 id");
    return {
        ...record,
        id,
        subject: requireString(record.subject, "群资料 subject"),
        description: optionalString(record.description, "群资料 description"),
        suspended: requireBoolean(record.suspended, "群资料 suspended"),
        creation_timestamp: requireTimestamp(
            record.creation_timestamp,
            "群资料 creation_timestamp",
        ),
        total_participant_count: requireNumber(
            record.total_participant_count,
            "群资料 total_participant_count",
        ),
        participants: requireArray(record.participants, "群资料 participants", parseParticipant),
        join_approval_mode: requireJoinApprovalMode(record.join_approval_mode),
    };
}

export function parseGroupListResponse(value: unknown): WhatsAppGroupListResponse {
    const record = requireRecord(value, "群列表响应");
    const data = requireRecord(record.data, "群列表响应 data");
    if (!Array.isArray(data.groups)) invalidResponse("群列表响应 data.groups 必须是数组");
    return {
        data: { groups: data.groups.map(parseGroupSummary) },
        paging: parsePaging(record.paging),
    };
}

function parseGroupSummary(value: unknown) {
    const record = requireRecord(value, "群摘要");
    return {
        id: requireString(record.id, "群摘要 id"),
        subject: requireString(record.subject, "群摘要 subject"),
        created_at: requireString(record.created_at, "群摘要 created_at"),
    };
}

export function parseGroupJoinRequestsResponse(value: unknown): WhatsAppGroupJoinRequestsResponse {
    const record = requireRecord(value, "入群申请响应");
    if (!Array.isArray(record.data)) invalidResponse("入群申请响应 data 必须是数组");
    return {
        data: record.data.map(parseJoinRequest),
        paging: parsePaging(record.paging),
    };
}

function parseParticipant(value: unknown): WhatsAppGroupParticipant {
    const record = requireRecord(value, "群成员");
    const participant = {
        user_id: optionalString(record.user_id, "群成员 user_id"),
        wa_id: optionalString(record.wa_id, "群成员 wa_id"),
        username: optionalString(record.username, "群成员 username"),
        parent_user_id: optionalString(record.parent_user_id, "群成员 parent_user_id"),
    };
    if (!participant.user_id && !participant.wa_id && !participant.username) {
        invalidResponse("群成员缺少 user_id、wa_id 或 username");
    }
    if (participant.user_id) return { ...participant, user_id: participant.user_id };
    if (participant.wa_id) return { ...participant, wa_id: participant.wa_id };
    const username = participant.username;
    if (!username) invalidResponse("群成员缺少 username");
    return { ...participant, username };
}

function parseJoinRequest(value: unknown): WhatsAppGroupJoinRequest {
    const record = requireRecord(value, "入群申请");
    const request = {
        join_request_id: requireString(record.join_request_id, "入群申请 join_request_id"),
        user_id: optionalString(record.user_id, "入群申请 user_id"),
        wa_id: optionalString(record.wa_id, "入群申请 wa_id"),
        username: optionalString(record.username, "入群申请 username"),
        creation_timestamp: requireTimestamp(
            record.creation_timestamp,
            "入群申请 creation_timestamp",
        ),
    };
    if (request.user_id) return { ...request, user_id: request.user_id };
    if (request.wa_id) return { ...request, wa_id: request.wa_id };
    if (request.username) return { ...request, username: request.username };
    invalidResponse("入群申请缺少 user_id、wa_id 或 username");
}

function parseWebhookError(value: unknown) {
    const record = requireRecord(value, "群操作错误");
    const code = record.code;
    if (typeof code !== "string" && typeof code !== "number") {
        invalidResponse("群操作错误 code 必须是字符串或数字");
    }
    return {
        code,
        message: requireString(record.message, "群操作错误 message"),
        title: optionalString(record.title, "群操作错误 title"),
    };
}

function parsePaging(value: unknown): WhatsAppPaging | undefined {
    if (value === undefined) return undefined;
    const record = requireRecord(value, "分页");
    const cursors =
        record.cursors === undefined ? undefined : requireRecord(record.cursors, "分页 cursors");
    return {
        cursors: cursors
            ? {
                  before: optionalString(cursors.before, "分页 before"),
                  after: optionalString(cursors.after, "分页 after"),
              }
            : undefined,
        previous: optionalString(record.previous, "分页 previous"),
        next: optionalString(record.next, "分页 next"),
    };
}

function optionalStringArray(value: unknown, name: string): string[] | undefined {
    if (value === undefined) return undefined;
    if (!Array.isArray(value)) invalidResponse(`${name} 必须是数组`);
    return value.map(item => requireString(item, name));
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        invalidResponse(`${name} 必须是对象`);
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
    const result = optionalString(value, name);
    if (!result) invalidResponse(`${name} 必须是非空字符串`);
    return result;
}

function optionalString(value: unknown, name: string): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string") invalidResponse(`${name} 必须是字符串`);
    return value;
}

function requireBoolean(value: unknown, name: string): boolean {
    if (typeof value !== "boolean") invalidResponse(`${name} 必须是布尔值`);
    return value;
}

function requireNumber(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isFinite(value)) invalidResponse(`${name} 必须是数字`);
    return value;
}

function requireTimestamp(value: unknown, name: string): string | number {
    const result = optionalTimestamp(value, name);
    if (result === undefined) invalidResponse(`${name} 不能为空`);
    return result;
}

function optionalTimestamp(value: unknown, name: string): string | number | undefined {
    if (value === undefined) return undefined;
    if (
        (typeof value !== "string" || !/^\d+$/u.test(value)) &&
        (typeof value !== "number" || !Number.isFinite(value))
    ) {
        invalidResponse(`${name} 必须是时间戳`);
    }
    return value as string | number;
}

function requireJoinApprovalMode(value: unknown): "auto_approve" | "approval_required" {
    if (value !== "auto_approve" && value !== "approval_required") {
        invalidResponse("群资料 join_approval_mode 无效");
    }
    return value;
}

function requireArray<T>(value: unknown, name: string, parse: (item: unknown) => T): T[] {
    if (!Array.isArray(value)) invalidResponse(`${name} 必须是数组`);
    return value.map(parse);
}

function optionalArray<T>(
    value: unknown,
    name: string,
    parse: (item: unknown) => T,
): T[] | undefined {
    if (value === undefined) return undefined;
    return requireArray(value, name, parse);
}

function invalidResponse(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_RESPONSE" });
}
