/**
 * Satori V1 Client Types
 */

export interface SatoriV1ClientConfig {
    /** 服务器地址，例如 http://localhost:6727 */
    baseUrl: string;
    /** 访问令牌 */
    accessToken?: string;
    apiBaseUrl?: string;
    resolveActionUrl?: SatoriActionUrlResolver;
    call?: SatoriCall;
    fetch?: typeof globalThis.fetch;
    /** 接收方式；manual 仅通过 ingest/acceptHttp/acceptWebSocket 接收。 */
    receiveMode?: "websocket" | "ws" | "wss" | "webhook" | "sse" | "manual";
    /** Webhook 接收地址（当 receiveMode 为 webhook 时使用） */
    webhookUrl?: string;
    /** Webhook 端口（当 receiveMode 为 webhook 时使用） */
    webhookPort?: number;
}

export interface SatoriV1Event {
    id: string;
    type: string;
    platform: string;
    self_id?: string;
    timestamp: number;
    channel?: { id: string; [key: string]: unknown };
    guild?: { id: string; [key: string]: unknown };
    user?: {
        id: string;
        name?: string;
        avatar?: string;
        username?: string;
        [key: string]: unknown;
    };
    operator?: { id: string; [key: string]: unknown };
    login?: {
        user?: { id: string; [key: string]: unknown };
        self_id?: string;
        status: number;
        [key: string]: unknown;
    };
    message?: {
        id: string;
        content?: string | unknown[];
        created_at?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

/** @deprecated Satori 原生 API 直接返回资源；请直接使用响应类型 T。 */
export type SatoriV1Response<T = unknown> = T;

export type SatoriCall = (
    resource: string,
    method: string,
    params?: Record<string, unknown>,
) => Promise<unknown>;

export type SatoriActionUrlResolver = (
    resource: string,
    method: string,
    apiBaseUrl: string,
) => string | URL;
