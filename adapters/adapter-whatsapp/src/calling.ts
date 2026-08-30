import type { PlatformActionHandler } from "onebots";
import { defineWhatsAppActionHandlers } from "./action-contract.js";
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

type CallingActionParams = Readonly<Record<string, unknown>>;

const CALLING_ACTION_HANDLERS = {
    get_call_permissions: (client: WhatsAppClient, params: CallingActionParams) =>
        client.calling.getPermission(stringParam(params, "user_id")),
    request_call_permission: (client: WhatsAppClient, params: CallingActionParams) =>
        client.calling.requestPermission(stringParam(params, "user_id")),
    connect_call: (client: WhatsAppClient, params: CallingActionParams) =>
        client.calling.connect({
            to: stringParam(params, "user_id"),
            session: { sdp_type: "offer", sdp: stringParam(params, "sdp") },
            biz_opaque_callback_data: optionalString(params, "biz_opaque_callback_data"),
        }),
    pre_accept_call: (client: WhatsAppClient, params: CallingActionParams) => {
        const sdp = optionalString(params, "sdp");
        return client.calling.preAccept({
            to: stringParam(params, "user_id"),
            ...(sdp ? { session: { sdp_type: "answer", sdp } } : {}),
        });
    },
    accept_call: (client: WhatsAppClient, params: CallingActionParams) =>
        client.calling.accept(stringParam(params, "user_id"), {
            sdp_type: "answer",
            sdp: stringParam(params, "sdp"),
        }),
    reject_call: (client: WhatsAppClient, params: CallingActionParams) =>
        client.calling.reject(stringParam(params, "user_id")),
    terminate_call: (client: WhatsAppClient, params: CallingActionParams) =>
        client.calling.terminate(stringParam(params, "call_id")),
} satisfies Readonly<Record<string, PlatformActionHandler<WhatsAppClient>>>;

/** Calling 动作的执行与参数契约单一来源。 */
export const WHATSAPP_CALLING_ACTION_HANDLERS = defineWhatsAppActionHandlers(
    CALLING_ACTION_HANDLERS,
    {
        get_call_permissions: ["user_id"],
        request_call_permission: ["user_id"],
        connect_call: ["user_id", "sdp", "biz_opaque_callback_data"],
        pre_accept_call: ["user_id", "sdp"],
        accept_call: ["user_id", "sdp"],
        reject_call: ["user_id"],
        terminate_call: ["call_id"],
    },
);

export type WhatsAppCallingAction = keyof typeof WHATSAPP_CALLING_ACTION_HANDLERS;

export function isWhatsAppCallingAction(action: string): action is WhatsAppCallingAction {
    return Object.hasOwn(WHATSAPP_CALLING_ACTION_HANDLERS, action);
}

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
