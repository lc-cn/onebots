import type { WebClientOptions } from "@slack/web-api";
import { ProxyAgent, Socks5ProxyAgent, fetch as undiciFetch, type Dispatcher } from "undici";
import { SlackError } from "./errors.js";
import type { SlackProxyConfig } from "./types.js";

/** 为 Web API 与 Socket Mode 创建同一个 Undici 代理边界。 */
export function createSlackDispatcher(proxy?: SlackProxyConfig): Dispatcher | undefined {
    if (!proxy?.url) return undefined;
    let url: URL;
    try {
        url = new URL(proxy.url);
    } catch {
        throw SlackError.config("Slack 代理地址不是有效 URL", "SLACK_PROXY_URL_INVALID");
    }
    if (url.username || url.password || url.search || url.hash) {
        throw SlackError.config(
            "Slack 代理凭据必须使用独立字段，地址不能包含查询或片段",
            "SLACK_PROXY_URL_INVALID",
        );
    }
    if (proxy.username) url.username = proxy.username;
    if (proxy.password) url.password = proxy.password;
    if (url.protocol === "socks5:") return new Socks5ProxyAgent(url);
    if (url.protocol === "http:" || url.protocol === "https:") return new ProxyAgent(url.href);
    throw SlackError.config("Slack 代理仅支持 HTTP、HTTPS 或 SOCKS5", "SLACK_PROXY_URL_INVALID");
}

/** 将 Undici dispatcher 注入 Slack v8 基于 Fetch 的 Web API。 */
export function createSlackFetch(dispatcher?: Dispatcher): WebClientOptions["fetch"] | undefined {
    if (!dispatcher) return undefined;
    type SlackFetch = NonNullable<WebClientOptions["fetch"]>;
    const fetchWithDispatcher: SlackFetch = (url, init) =>
        undiciFetch(url, {
            ...init,
            // Slack 的 FetchFunction 使用 DOM FormData；Node 运行时实际由 Undici 提供同一实现。
            body: init?.body as never,
            dispatcher,
        }) as unknown as ReturnType<SlackFetch>;
    return fetchWithDispatcher;
}
