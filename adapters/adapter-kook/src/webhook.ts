import { ReliableEventIngress } from "onebots";
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

export type KookEventDispatch = (event: KookEvent, signal: KookSignal) => void | PromiseLike<void>;

/** 可挂载到任意 HTTP Host 的 KOOK Webhook 接收器。 */
export class KookWebhookReceiver {
    private readonly ingress = new ReliableEventIngress<number>();

    constructor(private readonly config: Pick<KookConfig, "verify_token" | "encrypt_key">) {}

    async ingest(rawEvent: unknown, dispatch: KookEventDispatch): Promise<KookIngestResult> {
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
            return { status: 200, body: { challenge: event.challenge } };
        }
        const sequence = signal.sn;
        try {
            const delivered =
                typeof sequence === "number"
                    ? await this.ingress.deliver(sequence, () => dispatch(event, signal))
                    : await dispatchAndMark(dispatch, event, signal);
            if (!delivered) {
                return { status: 200, body: { success: true, duplicate: true } };
            }
        } catch (error) {
            throw KookError.wrap(error, "KOOK_EVENT_DELIVERY_FAILED");
        }
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
            const result = await this.ingest(raw, dispatch);
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
}

async function dispatchAndMark(
    dispatch: KookEventDispatch,
    event: KookEvent,
    signal: KookSignal,
): Promise<true> {
    await dispatch(event, signal);
    return true;
}

export function kookWebhookErrorStatus(error: KookError): number {
    return error.code === "KOOK_EVENT_DELIVERY_FAILED" ? 500 : 400;
}
