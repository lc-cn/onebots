import { KookError } from "./errors.js";
import type { KookConfig, KookEvent, KookSignal } from "./types.js";
import {
    decryptWebhookMessage,
    objectValue,
    parseEvent,
    parseSignal,
    stringValue,
} from "./utils.js";

export interface KookIngestResult {
    status: number;
    body: Readonly<Record<string, unknown>>;
    event?: KookEvent;
    events?: KookEvent[];
    signal?: KookSignal;
}

export type KookEventDispatch = (event: KookEvent, signal: KookSignal) => void;

/** 可挂载到任意 HTTP Host 的 KOOK Webhook 接收器。 */
export class KookWebhookReceiver {
    private readonly sequences = new Set<number>();

    constructor(private readonly config: Pick<KookConfig, "verify_token" | "encrypt_key">) {}

    ingest(rawEvent: unknown, dispatch: KookEventDispatch): KookIngestResult {
        const incoming = objectValue(rawEvent);
        const encrypted = stringValue(incoming.encrypt);
        const payload = encrypted ? this.decrypt(encrypted) : incoming;
        const signal = parseSignal(payload);
        if (signal.s !== 0 || !signal.d) {
            throw KookError.invalid("KOOK Webhook 只接受事件信令", "KOOK_WEBHOOK_SIGNAL_INVALID", {
                signal: signal.s,
            });
        }
        const event = parseEvent(signal.d);
        if (this.config.verify_token && event.verify_token !== this.config.verify_token) {
            return { status: 401, body: { error: "Invalid verify_token" } };
        }
        if (event.channel_type === "WEBHOOK_CHALLENGE") {
            return { status: 200, body: { challenge: event.challenge || "" } };
        }
        if (typeof signal.sn === "number" && this.sequences.has(signal.sn)) {
            return { status: 200, body: { success: true, duplicate: true } };
        }
        try {
            dispatch(event, signal);
        } catch (error) {
            throw KookError.wrap(error, "KOOK_EVENT_DELIVERY_FAILED");
        }
        if (typeof signal.sn === "number") this.rememberSequence(signal.sn);
        return { status: 200, body: { success: true }, event, signal };
    }

    async acceptHttp(request: Request, dispatch: KookEventDispatch): Promise<Response> {
        if (request.method !== "POST") {
            return Response.json(
                { error: "Method Not Allowed", code: "KOOK_WEBHOOK_METHOD_INVALID" },
                { status: 405, headers: { Allow: "POST" } },
            );
        }
        try {
            const raw = (await request.json()) as unknown;
            const result = this.ingest(raw, dispatch);
            return Response.json(result.body, { status: result.status });
        } catch (error) {
            const wrapped = KookError.wrap(error, "KOOK_WEBHOOK_INVALID");
            return Response.json(
                { error: wrapped.message, code: wrapped.code },
                { status: kookWebhookErrorStatus(wrapped) },
            );
        }
    }

    private decrypt(encrypted: string): Record<string, unknown> {
        try {
            return objectValue(
                JSON.parse(decryptWebhookMessage(encrypted, this.config.encrypt_key || "")),
            );
        } catch (error) {
            throw KookError.wrap(error, "KOOK_WEBHOOK_DECRYPT_FAILED");
        }
    }

    private rememberSequence(sn: number): void {
        this.sequences.add(sn);
        if (this.sequences.size > 2_048) {
            const oldest = this.sequences.values().next().value;
            if (typeof oldest === "number") this.sequences.delete(oldest);
        }
    }
}

export function kookWebhookErrorStatus(error: KookError): number {
    return error.code === "KOOK_EVENT_DELIVERY_FAILED" ? 500 : 400;
}
