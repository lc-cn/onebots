/**
 * Satori V1 Client Types
 */

export interface SatoriV1Event {
    id: string;
    type: string;
    platform: string;
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
        status: number;
        [key: string]: unknown;
    };
    message?: {
        id: string;
        content?: string | SatoriElement[];
        created_at?: number;
        [key: string]: unknown;
    };
    [key: string]: unknown;
}

export interface SatoriElement {
    type: string;
    attrs?: Record<string, unknown>;
    children?: Array<SatoriElement | string>;
}

export type SatoriGatewayPayload =
    | { op: 0; body: SatoriV1Event }
    | { op: 2; body?: unknown }
    | { op: 4; body: { logins: Array<Record<string, unknown>> } };

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
