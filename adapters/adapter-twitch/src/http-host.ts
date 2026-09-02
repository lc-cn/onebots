import type { BaseApp } from "onebots";
import type { TwitchClient } from "./client.js";
import { assertHttpPath } from "./configuration.js";
import { TwitchError } from "./errors.js";

interface TwitchKoaContext {
    method: string;
    url: string;
    status: number;
    body: unknown;
    request: { rawBody?: string | Uint8Array };
    get(name: string): string;
    set(name: string, value: string): void;
}

/** 内建 Koa Host 仅负责桥接；验签、时窗、去重和投递始终由同一 Client 完成。 */
export class TwitchHttpHost {
    private readonly owners = new Map<string, string>();
    private readonly accountPaths = new Map<string, string>();
    private readonly mounted = new Set<string>();

    constructor(
        private readonly app: BaseApp,
        private readonly resolveClient: (accountId: string) => TwitchClient | undefined,
    ) {}

    mount(accountId: string, client: TwitchClient): void {
        if (client.receiveMode !== "webhook") return;
        const path = assertHttpPath(client.config.http_path || "");
        const owner = this.owners.get(path);
        if (owner && owner !== accountId && this.isActive(path, owner)) {
            throw new TwitchError(`Twitch EventSub HTTP 路径 ${path} 已由账号 ${owner} 使用`, {
                code: "TWITCH_HTTP_PATH_CONFLICT",
            });
        }
        this.owners.set(path, accountId);
        this.accountPaths.set(accountId, path);
        if (this.mounted.has(path)) return;
        this.mounted.add(path);
        this.app.router.post(path, ctx => this.accept(path, ctx));
    }

    private async accept(path: string, ctx: TwitchKoaContext): Promise<void> {
        const owner = this.owners.get(path);
        const client = owner ? this.resolveClient(owner) : undefined;
        if (!owner || !client || !this.isActive(path, owner)) {
            ctx.status = 404;
            ctx.body = { error: { code: "NOT_FOUND", message: "Twitch EventSub 路由未激活" } };
            return;
        }
        const raw = ctx.request.rawBody;
        if (typeof raw !== "string" && !(raw instanceof Uint8Array)) {
            ctx.status = 500;
            ctx.body = {
                error: {
                    code: "TWITCH_RAW_BODY_REQUIRED",
                    message: "Twitch EventSub 验签必须保留未经修改的 rawBody",
                },
            };
            return;
        }
        const body = typeof raw === "string" ? new TextEncoder().encode(raw) : new Uint8Array(raw);
        const headers = new Headers();
        for (const name of [
            "content-type",
            "content-length",
            "twitch-eventsub-message-id",
            "twitch-eventsub-message-type",
            "twitch-eventsub-message-signature",
            "twitch-eventsub-message-timestamp",
            "twitch-eventsub-subscription-type",
            "twitch-eventsub-subscription-version",
        ]) {
            const value = ctx.get(name);
            if (value) headers.set(name, value);
        }
        const response = await client.acceptHttp(
            new Request(`http://onebots.local${ctx.url}`, {
                method: ctx.method,
                headers,
                body,
            }),
        );
        ctx.status = response.status;
        response.headers.forEach((value, name) => ctx.set(name, value));
        const text = await response.text();
        ctx.body = response.status === 204 ? undefined : responseBody(text, response.headers);
    }

    private isActive(path: string, accountId: string): boolean {
        const client = this.resolveClient(accountId);
        return Boolean(
            client && client.receiveMode === "webhook" && this.accountPaths.get(accountId) === path,
        );
    }
}

function responseBody(text: string, headers: Headers): unknown {
    if (!headers.get("content-type")?.includes("application/json") || !text) return text;
    try {
        return JSON.parse(text) as unknown;
    } catch {
        return text;
    }
}
