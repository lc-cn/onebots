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
 * ingest 会等待同步与异步监听器；任一投递失败都不发送 ack，Slack 可按 envelope_id
 * 重投。成功路径才确认并提交去重状态。
 */
export async function acceptSlackSocketEnvelope(
    value: unknown,
    ingest: (body: SlackWebhookBody) => void | Promise<void>,
): Promise<boolean> {
    if (!isSlackSocketEnvelope(value)) return false;
    const body = value.body ?? { type: value.type };
    await ingest(
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
