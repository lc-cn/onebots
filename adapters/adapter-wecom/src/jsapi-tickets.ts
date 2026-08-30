import { RefreshableValue } from "onebots";
import { WeComApiError } from "./errors.js";
import type { WeComCallOptions } from "./types.js";

const TICKET_REFRESH_MARGIN_MS = 120_000;

interface TicketResponse {
    ticket?: string;
    expires_in?: number;
}

type TicketLoader = (options: WeComCallOptions) => Promise<TicketResponse>;

/** 企业级与应用级 JS-SDK ticket 的独立缓存。 */
export class WeComJsApiTickets {
    private readonly corp = new RefreshableValue<string>(TICKET_REFRESH_MARGIN_MS);
    private readonly agent = new RefreshableValue<string>(TICKET_REFRESH_MARGIN_MS);

    getCorp(load: TicketLoader, force = false): Promise<string> {
        return this.get(this.corp, load, "/cgi-bin/get_jsapi_ticket", undefined, force);
    }

    getAgent(load: TicketLoader, force = false): Promise<string> {
        return this.get(this.agent, load, "/cgi-bin/ticket/get", { type: "agent_config" }, force);
    }

    clear(): void {
        this.corp.clear();
        this.agent.clear();
    }

    private get(
        cache: RefreshableValue<string>,
        load: TicketLoader,
        path: string,
        query: WeComCallOptions["query"],
        force: boolean,
    ): Promise<string> {
        return cache.get(async () => {
            const data = await load({ path, query });
            if (!data.ticket || !data.expires_in) {
                throw new WeComApiError("企业微信 JS-SDK ticket 响应缺少必要字段", {
                    code: "WECOM_INVALID_JSAPI_TICKET_RESPONSE",
                    path,
                    details: data,
                });
            }
            return { value: data.ticket, ttlMs: data.expires_in * 1000 };
        }, force);
    }
}
