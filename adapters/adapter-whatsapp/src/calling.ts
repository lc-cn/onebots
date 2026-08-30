import type { PlatformActionHandler } from "onebots";
import {
    parseCallPermissionResponse,
    parseCallResponse,
    parseCallTerminateResponse,
} from "./call-responses.js";
import type {
    WhatsAppCallConnectParams,
    WhatsAppCallManageParams,
    WhatsAppCallPermissionResponse,
    WhatsAppCallResponse,
    WhatsAppCallSession,
    WhatsAppCallTerminateResponse,
} from "./calling-types.js";
import type { WhatsAppClient } from "./client.js";
import { WhatsAppApiError } from "./errors.js";
import type { WhatsAppAPIResponse } from "./types.js";

export const WHATSAPP_CALLING_ACTIONS = Object.freeze([
    "get_call_permissions",
    "request_call_permission",
    "connect_call",
    "pre_accept_call",
    "accept_call",
    "reject_call",
    "terminate_call",
] as const);

export type WhatsAppCallingAction = (typeof WHATSAPP_CALLING_ACTIONS)[number];

export function isWhatsAppCallingAction(action: string): action is WhatsAppCallingAction {
    return (WHATSAPP_CALLING_ACTIONS as readonly string[]).includes(action);
}

/**
 * WhatsApp Calling API 控制平面。
 *
 * 此模块只负责权限、信令动作和 SDP 载荷；WebRTC/SIP 媒体平面必须由调用方实现。
 */
export class WhatsAppCalling {
    constructor(private readonly client: WhatsAppClient) {}

    async getPermission(userWaId: string): Promise<WhatsAppCallPermissionResponse> {
        return parseCallPermissionResponse(
            await this.client.call<unknown>({
                resource: `${this.client.config.phone_number_id}/call_permissions`,
                query: { user_wa_id: identifier(userWaId, "user_wa_id") },
            }),
        );
    }

    requestPermission(to: string): Promise<WhatsAppAPIResponse> {
        return this.client.sendMessage({
            recipient_type: "individual",
            to: identifier(to, "to"),
            type: "interactive",
            interactive: {
                type: "call_permission_request",
                action: { name: "call_permission_request" },
            },
        });
    }

    async connect(params: WhatsAppCallConnectParams): Promise<WhatsAppCallResponse> {
        const callbackData = params.biz_opaque_callback_data;
        if (callbackData !== undefined && callbackData.length > 512) {
            invalidParameter("biz_opaque_callback_data 不能超过 512 字符");
        }
        return this.manage("connect", {
            to: identifier(params.to, "to"),
            session: session(params.session, "offer"),
            ...(callbackData !== undefined ? { biz_opaque_callback_data: callbackData } : {}),
        });
    }

    async preAccept(params: WhatsAppCallManageParams): Promise<WhatsAppCallResponse> {
        return this.manage("pre_accept", {
            to: identifier(params.to, "to"),
            ...(params.session ? { session: session(params.session, "answer") } : {}),
        });
    }

    async accept(to: string, answer: WhatsAppCallSession<"answer">): Promise<WhatsAppCallResponse> {
        return this.manage("accept", {
            to: identifier(to, "to"),
            session: session(answer, "answer"),
        });
    }

    async reject(to: string): Promise<WhatsAppCallResponse> {
        return this.manage("reject", { to: identifier(to, "to") });
    }

    async terminate(callId: string): Promise<WhatsAppCallTerminateResponse> {
        return parseCallTerminateResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/calls`,
                body: {
                    messaging_product: "whatsapp",
                    call_id: identifier(callId, "call_id"),
                    action: "terminate",
                },
            }),
        );
    }

    execute(
        action: WhatsAppCallingAction,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        switch (action) {
            case "get_call_permissions":
                return this.getPermission(stringParam(params, "user_id"));
            case "request_call_permission":
                return this.requestPermission(stringParam(params, "user_id"));
            case "connect_call":
                return this.connect({
                    to: stringParam(params, "user_id"),
                    session: { sdp_type: "offer", sdp: stringParam(params, "sdp") },
                    biz_opaque_callback_data: optionalString(params, "biz_opaque_callback_data"),
                });
            case "pre_accept_call": {
                const sdp = optionalString(params, "sdp");
                return this.preAccept({
                    to: stringParam(params, "user_id"),
                    ...(sdp ? { session: { sdp_type: "answer", sdp } } : {}),
                });
            }
            case "accept_call":
                return this.accept(stringParam(params, "user_id"), {
                    sdp_type: "answer",
                    sdp: stringParam(params, "sdp"),
                });
            case "reject_call":
                return this.reject(stringParam(params, "user_id"));
            case "terminate_call":
                return this.terminate(stringParam(params, "call_id"));
        }
    }

    private async manage(
        action: "connect" | "pre_accept" | "accept" | "reject",
        params: Readonly<Record<string, unknown>>,
    ): Promise<WhatsAppCallResponse> {
        return parseCallResponse(
            await this.client.call<unknown>({
                method: "POST",
                resource: `${this.client.config.phone_number_id}/calls`,
                body: { messaging_product: "whatsapp", action, ...params },
            }),
        );
    }
}

export const WHATSAPP_CALLING_ACTION_HANDLERS = Object.fromEntries(
    WHATSAPP_CALLING_ACTIONS.map(action => [
        action,
        (client: WhatsAppClient, params: Readonly<Record<string, unknown>>) =>
            client.calling.execute(action, params),
    ]),
) as Record<WhatsAppCallingAction, PlatformActionHandler<WhatsAppClient>>;

function session<TType extends "offer" | "answer">(
    value: WhatsAppCallSession<TType>,
    expectedType: TType,
): WhatsAppCallSession<TType> {
    if (value.sdp_type !== expectedType) invalidParameter(`sdp_type 必须是 ${expectedType}`);
    return { sdp_type: expectedType, sdp: identifier(value.sdp, "sdp") };
}

function identifier(value: string, name: string): string {
    if (!value.trim()) invalidParameter(`${name} 不能为空`);
    return value;
}

function stringParam(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string") invalidParameter(`${name} 必须是非空字符串`);
    return identifier(value, name);
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (typeof value !== "string") invalidParameter(`${name} 必须是字符串`);
    return value;
}

function invalidParameter(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
