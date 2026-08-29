import { delay } from "./internal/async-tools.js";
import {
    ILINK_LONG_WAIT_MS,
    ILINK_RETRY_INITIAL_MS,
    ILINK_RETRY_MAX_MS,
} from "./internal/config.js";
import { GatewayFault, StaleCredentialFault } from "./internal/errors.js";
import type { CredentialBlob, PollingOptions } from "./protocol/chat-event.js";
import type { InboundWirePacket } from "./protocol/wire-models.js";
import type { IlinkJsonTransport } from "./transport/ilink-json-transport.js";

export interface PollingLoopContext {
    transport: IlinkJsonTransport;
    session: CredentialBlob;
    options: PollingOptions;
    signal: AbortSignal;
    isCurrent(): boolean;
    persist(): Promise<void>;
    ingest(event: InboundWirePacket): Promise<unknown>;
    credentialStale(error: StaleCredentialFault): Promise<void>;
    reportError(error: unknown): void;
}

/** 执行单个 generation 的无限长轮询；代际与中止状态均由宿主管理。 */
export async function runPollingLoop(context: PollingLoopContext): Promise<void> {
    let ceiling = context.options.timeoutMs ?? ILINK_LONG_WAIT_MS;
    let retryDelay = context.options.retryInitialDelayMs ?? ILINK_RETRY_INITIAL_MS;
    const retryMax = Math.max(retryDelay, context.options.retryMaxDelayMs ?? ILINK_RETRY_MAX_MS);
    while (context.isCurrent() && !context.signal.aborted) {
        try {
            const batch = await context.transport.pullUnreadBatch(
                context.session.syncBuffer ?? "",
                ceiling,
                context.signal,
            );
            if ((batch.errcode ?? batch.ret ?? 0) === -14) {
                throw new StaleCredentialFault(batch.errmsg ?? "凭证失效");
            }
            if ((batch.errcode ?? 0) !== 0 || (batch.ret ?? 0) !== 0) {
                throw new GatewayFault(
                    "GET_UPDATES_FAILED",
                    `getupdates 异常 ret=${String(batch.ret ?? "")} errcode=${String(batch.errcode ?? "")}`,
                );
            }
            if (batch.longpolling_timeout_ms && batch.longpolling_timeout_ms > 0) {
                ceiling = batch.longpolling_timeout_ms;
            }
            for (const event of batch.msgs ?? []) {
                try {
                    await context.ingest(event);
                } catch (error) {
                    // 单条畸形事件不能阻断同批后续消息；错误仍交给宿主完整记录。
                    context.reportError(error);
                }
            }
            // 仅在整批事件均已尝试投递后提交游标，保证进程异常时至少一次交付。
            if (typeof batch.get_updates_buf === "string") {
                context.session.syncBuffer = batch.get_updates_buf;
                await context.persist();
            }
            retryDelay = context.options.retryInitialDelayMs ?? ILINK_RETRY_INITIAL_MS;
        } catch (error) {
            if (context.signal.aborted || !context.isCurrent()) break;
            if (error instanceof StaleCredentialFault) {
                await context.credentialStale(error);
                break;
            }
            context.reportError(error);
            await delay(retryDelay, context.signal);
            retryDelay = Math.min(retryDelay * 2, retryMax);
        }
    }
}
