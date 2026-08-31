import type { SlackWebhookBody } from "./types.js";

export interface SlackSocketEnvelope {
    ack(): Promise<void>;
    body?: SlackWebhookBody;
    envelope_id?: string;
    type?: string;
}

/**
 * 在 canonical 投递成功后才确认 Socket Mode envelope。
 *
 * Slack 的监听回调是同步进入本地 EventEmitter 的，因此投影或业务监听器抛错时不会
 * 发送 ack，Slack 可以按 envelope_id 重投；成功路径再确认并进入去重窗口。
 */
export async function acceptSlackSocketEnvelope(
    value: unknown,
    ingest: (body: SlackWebhookBody) => void,
): Promise<boolean> {
    if (!isSlackSocketEnvelope(value)) return false;
    const body = value.body ?? { type: value.type };
    ingest(
        value.envelope_id && !body.envelope_id ? { ...body, envelope_id: value.envelope_id } : body,
    );
    await value.ack();
    return true;
}

function isSlackSocketEnvelope(value: unknown): value is SlackSocketEnvelope {
    return (
        typeof value === "object" &&
        value !== null &&
        "ack" in value &&
        typeof value.ack === "function"
    );
}
