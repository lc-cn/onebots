/** WhatsApp Calling API 当前授权状态。 */
export type WhatsAppCallPermissionStatus = "granted" | "pending" | "denied" | "expired";

/** 权限查询返回的可执行动作。 */
export type WhatsAppCallPermissionActionName = "start_call" | "send_call_permission_request";

export interface WhatsAppCallPermissionLimit {
    time_period: string;
    current_usage: number;
    max_allowed: number;
    limit_expiration_time?: number;
}

export interface WhatsAppCallPermissionAction {
    action_name: WhatsAppCallPermissionActionName;
    can_perform_action: boolean;
    limits?: WhatsAppCallPermissionLimit[] | null;
}

export interface WhatsAppCallPermissionResponse {
    messaging_product: "whatsapp";
    permission: {
        status: WhatsAppCallPermissionStatus;
        expiration_time?: number;
    };
    actions?: WhatsAppCallPermissionAction[];
}

export interface WhatsAppCallSession<TType extends "offer" | "answer"> {
    sdp_type: TType;
    /** RFC 8866 Session Description。媒体传输与生命周期由调用方负责。 */
    sdp: string;
}

export interface WhatsAppCallResponse {
    messaging_product: "whatsapp";
    calls: Array<{ id: string }>;
}

export interface WhatsAppCallTerminateResponse {
    success: true;
}

export interface WhatsAppCallConnectParams {
    to: string;
    session: WhatsAppCallSession<"offer">;
    /** 会在后续 calls webhook 中回传，最长 512 字符。 */
    biz_opaque_callback_data?: string;
}

export interface WhatsAppCallManageParams {
    to: string;
    /** Meta v23 Schema 允许 pre_accept 携带协商结果。 */
    session?: WhatsAppCallSession<"answer">;
}
