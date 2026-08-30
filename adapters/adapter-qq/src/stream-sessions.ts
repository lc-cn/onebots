import { randomUUID } from "node:crypto";
import type { MessageResponse, StreamSession } from "@tencent-connect/qqbot-nodejs";
import { ErrorCategory } from "onebots";
import { QQApiError } from "./errors.js";

const MAX_ACTIVE_STREAMS = 100;
const STREAM_IDLE_TTL_MS = 15 * 60 * 1000;

interface ManagedStream {
    readonly session: StreamSession;
    touchedAt: number;
}

/** 管理跨协议调用的 QQ C2C 流式会话，并为 SDK 的进程内对象提供稳定句柄。 */
export class QQStreamSessions {
    private readonly streams = new Map<string, ManagedStream>();

    create(session: StreamSession): string {
        this.sweepExpired();
        if (this.streams.size >= MAX_ACTIVE_STREAMS) {
            session.cancel();
            throw new QQApiError("QQ C2C 流式会话已达到并发上限", {
                code: "QQ_STREAM_LIMIT_EXCEEDED",
                category: ErrorCategory.RUNTIME,
                details: { limit: MAX_ACTIVE_STREAMS },
            });
        }
        const streamId = randomUUID();
        this.streams.set(streamId, { session, touchedAt: Date.now() });
        return streamId;
    }

    async update(streamId: string, content: string): Promise<void> {
        const stream = this.require(streamId);
        stream.touchedAt = Date.now();
        await stream.session.update(content);
    }

    async complete(streamId: string): Promise<MessageResponse | undefined> {
        const stream = this.require(streamId);
        this.streams.delete(streamId);
        return stream.session.complete();
    }

    cancel(streamId: string): void {
        const stream = this.require(streamId);
        this.streams.delete(streamId);
        stream.session.cancel();
    }

    cancelAll(): void {
        for (const stream of this.streams.values()) stream.session.cancel();
        this.streams.clear();
    }

    private require(streamId: string): ManagedStream {
        this.sweepExpired();
        const stream = this.streams.get(streamId);
        if (stream) return stream;
        throw new QQApiError("QQ C2C 流式会话不存在或已结束", {
            code: "QQ_STREAM_NOT_FOUND",
            category: ErrorCategory.RESOURCE,
            details: { stream_id: streamId },
        });
    }

    private sweepExpired(now = Date.now()): void {
        for (const [streamId, stream] of this.streams) {
            if (now - stream.touchedAt < STREAM_IDLE_TTL_MS) continue;
            stream.session.cancel();
            this.streams.delete(streamId);
        }
    }
}
