export type MetaReceiveMode = "webhook" | "manual";
export type MetaGraphMethod = "GET" | "POST" | "DELETE";
export type MetaQueryValue = string | number | boolean | readonly string[] | undefined;

export interface MetaGraphConfig {
    accessToken: string;
    apiVersion?: string;
    apiOrigin?: string;
    appSecret?: string;
    useAppSecretProof?: boolean;
}

export interface MetaGraphCallOptions {
    query?: Readonly<Record<string, MetaQueryValue>>;
    body?: unknown;
    form?: FormData;
    signal?: AbortSignal;
}

export interface MetaGraphUsage {
    app?: unknown;
    page?: unknown;
    businessUseCase?: unknown;
    traceId?: string;
}

export interface MetaGraphResult<T> {
    data: T;
    usage: MetaGraphUsage;
}

export interface MetaWebhookConfig {
    receiveMode?: MetaReceiveMode;
    verifyToken?: string;
    appSecret?: string;
    httpPath?: string;
    maxBodyBytes?: number;
}

export interface MetaHttpRequest {
    method: string;
    url: string;
    headers?: Readonly<Record<string, string | undefined>>;
    /** POST 签名覆盖的精确原始字节；不能由已解析 JSON 重新序列化。 */
    rawBody?: Uint8Array;
}

export interface MetaHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: string | Record<string, unknown>;
}

export interface MetaWebhookDelivery<TEvent, TRawEnvelope = unknown> {
    id: string;
    event: TEvent;
    rawEnvelope: TRawEnvelope;
}

export interface MetaIngestResult<TEvent, TRawEnvelope = unknown> {
    accepted: boolean;
    duplicate: boolean;
    delivery: MetaWebhookDelivery<TEvent, TRawEnvelope>;
}

export interface MetaWebhookCodec<TEvent, TRawEnvelope> {
    parse(value: unknown): TRawEnvelope;
    expand(envelope: TRawEnvelope): MetaWebhookDelivery<TEvent, TRawEnvelope>[];
}

export interface MetaWebhookClientEvents<TEvent, TRawEnvelope> {
    event: [delivery: MetaWebhookDelivery<TEvent, TRawEnvelope>];
    ready: [];
    error: [error: Error];
    stop: [];
}
