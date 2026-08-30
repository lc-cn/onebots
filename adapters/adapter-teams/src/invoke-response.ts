import { KeyedSingleFlight, stableJsonStringify } from "onebots";
import type { TeamsEvent } from "./types.js";

export interface TeamsInvokeResponse {
    status: number;
    body?: unknown;
}

export interface TeamsAdaptiveCardInvokeBody {
    statusCode: number;
    type: string;
    value: unknown;
}

export type TeamsInvokeHandler = (
    event: TeamsEvent,
) => TeamsInvokeResponse | undefined | Promise<TeamsInvokeResponse | undefined>;

const DEFAULT_CACHE_SIZE = 1_024;

/** 将 Invoke 处理器、默认 Action.Execute 确认与重投结果缓存收口到同一模块。 */
export class TeamsInvokeResponder {
    private readonly responses = new Map<string, TeamsInvokeResponse>();
    private readonly pending = new KeyedSingleFlight<string, TeamsInvokeResponse | undefined>();
    private handler?: TeamsInvokeHandler;
    private generation = 0;

    constructor(private readonly cacheSize = DEFAULT_CACHE_SIZE) {
        if (!Number.isSafeInteger(cacheSize) || cacheSize <= 0) {
            throw new TypeError("Teams Invoke 响应缓存大小必须是正整数");
        }
    }

    setHandler(handler?: TeamsInvokeHandler): void {
        this.handler = handler;
        this.generation += 1;
        this.responses.clear();
        this.pending.clear();
    }

    respond(event: TeamsEvent): Promise<TeamsInvokeResponse | undefined> {
        const eventId = event.activity.id;
        const cached = this.responses.get(eventId);
        if (cached) return Promise.resolve(cloneInvokeResponse(cached));
        return this.pending.run(eventId, async () => {
            const retry = this.responses.get(eventId);
            if (retry) return cloneInvokeResponse(retry);
            const generation = this.generation;
            const response = this.handler
                ? await this.handler(event)
                : defaultInvokeResponse(event);
            if (!response) return undefined;
            validateInvokeResponse(response);
            const normalized = cloneInvokeResponse(response);
            if (generation !== this.generation) return normalized;
            this.responses.set(eventId, normalized);
            while (this.responses.size > this.cacheSize) {
                const oldest = this.responses.keys().next().value;
                if (typeof oldest !== "string") break;
                this.responses.delete(oldest);
            }
            return cloneInvokeResponse(normalized);
        });
    }
}

/** 构造符合 Universal Action Model 的 HTTP 200 + 内层业务状态响应。 */
export function createAdaptiveCardInvokeResponse(
    type: string,
    value: unknown,
    statusCode = 200,
): TeamsInvokeResponse {
    return {
        status: 200,
        body: { statusCode, type, value } satisfies TeamsAdaptiveCardInvokeBody,
    };
}

export function createAdaptiveCardMessageResponse(
    message: string,
    statusCode = 200,
): TeamsInvokeResponse {
    return createAdaptiveCardInvokeResponse(
        "application/vnd.microsoft.activity.message",
        message,
        statusCode,
    );
}

function defaultInvokeResponse(event: TeamsEvent): TeamsInvokeResponse | undefined {
    if (event.activity.name !== "adaptiveCard/action") return undefined;
    return createAdaptiveCardMessageResponse("操作已接收");
}

function validateInvokeResponse(response: TeamsInvokeResponse): void {
    if (!Number.isSafeInteger(response.status) || response.status < 100 || response.status > 599) {
        throw new TypeError("Teams Invoke 响应 status 必须是 100 到 599 的整数");
    }
}

function cloneInvokeResponse(response: TeamsInvokeResponse): TeamsInvokeResponse {
    try {
        return JSON.parse(stableJsonStringify(response)) as TeamsInvokeResponse;
    } catch (error) {
        throw new TypeError("Teams Invoke 响应必须是可序列化的 JSON", { cause: error });
    }
}
