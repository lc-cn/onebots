import { WhatsAppApiError } from "./errors.js";
import type {
    WhatsAppCallPermissionAction,
    WhatsAppCallPermissionActionName,
    WhatsAppCallPermissionLimit,
    WhatsAppCallPermissionResponse,
    WhatsAppCallPermissionStatus,
    WhatsAppCallResponse,
    WhatsAppCallTerminateResponse,
} from "./calling-types.js";

const PERMISSION_STATUSES = new Set<WhatsAppCallPermissionStatus>([
    "granted",
    "pending",
    "denied",
    "expired",
]);
const PERMISSION_ACTIONS = new Set<WhatsAppCallPermissionActionName>([
    "start_call",
    "send_call_permission_request",
]);

export function parseCallPermissionResponse(value: unknown): WhatsAppCallPermissionResponse {
    const response = record(value);
    const permission = record(response?.permission);
    if (!permission) invalidResponse("呼叫权限响应缺少 permission");
    const status = permission?.status;
    if (
        response?.messaging_product !== "whatsapp" ||
        typeof status !== "string" ||
        !PERMISSION_STATUSES.has(status as WhatsAppCallPermissionStatus) ||
        (permission.expiration_time !== undefined && !isInteger(permission.expiration_time))
    ) {
        invalidResponse("呼叫权限响应缺少有效 permission");
    }
    const actions = response.actions;
    if (actions !== undefined && !Array.isArray(actions)) {
        invalidResponse("呼叫权限响应的 actions 必须是数组");
    }
    return {
        messaging_product: "whatsapp",
        permission: {
            status: status as WhatsAppCallPermissionStatus,
            ...(isInteger(permission.expiration_time)
                ? { expiration_time: permission.expiration_time }
                : {}),
        },
        ...(actions ? { actions: actions.map(parsePermissionAction) } : {}),
    };
}

export function parseCallResponse(value: unknown): WhatsAppCallResponse {
    const response = record(value);
    if (response?.messaging_product !== "whatsapp" || !Array.isArray(response.calls)) {
        invalidResponse("呼叫操作响应缺少 calls");
    }
    const calls = response.calls.map(item => {
        const call = record(item);
        if (!nonEmptyString(call?.id)) invalidResponse("呼叫操作响应缺少 call id");
        return { id: call.id };
    });
    if (calls.length === 0) invalidResponse("呼叫操作响应的 calls 不能为空");
    return { messaging_product: "whatsapp", calls };
}

export function parseCallTerminateResponse(value: unknown): WhatsAppCallTerminateResponse {
    const response = record(value);
    if (response?.success !== true) invalidResponse("终止呼叫响应缺少 success: true");
    return { success: true };
}

function parsePermissionAction(value: unknown): WhatsAppCallPermissionAction {
    const action = record(value);
    if (!action) invalidResponse("呼叫权限响应包含无效 action");
    const actionName = action?.action_name;
    if (
        typeof actionName !== "string" ||
        !PERMISSION_ACTIONS.has(actionName as WhatsAppCallPermissionActionName) ||
        typeof action.can_perform_action !== "boolean"
    ) {
        invalidResponse("呼叫权限响应包含无效 action");
    }
    if (action.limits !== undefined && action.limits !== null && !Array.isArray(action.limits)) {
        invalidResponse("呼叫权限 action 的 limits 必须是数组或 null");
    }
    return {
        action_name: actionName as WhatsAppCallPermissionActionName,
        can_perform_action: action.can_perform_action,
        ...(action.limits === null
            ? { limits: null }
            : Array.isArray(action.limits)
              ? { limits: action.limits.map(parsePermissionLimit) }
              : {}),
    };
}

function parsePermissionLimit(value: unknown): WhatsAppCallPermissionLimit {
    const limit = record(value);
    if (
        !nonEmptyString(limit?.time_period) ||
        !isInteger(limit.current_usage) ||
        !isInteger(limit.max_allowed) ||
        (limit.limit_expiration_time !== undefined && !isInteger(limit.limit_expiration_time))
    ) {
        invalidResponse("呼叫权限响应包含无效 limit");
    }
    return {
        time_period: limit.time_period,
        current_usage: limit.current_usage,
        max_allowed: limit.max_allowed,
        ...(isInteger(limit.limit_expiration_time)
            ? { limit_expiration_time: limit.limit_expiration_time }
            : {}),
    };
}

function record(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function nonEmptyString(value: unknown): value is string {
    return typeof value === "string" && value.trim().length > 0;
}

function isInteger(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value);
}

function invalidResponse(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_RESPONSE" });
}
