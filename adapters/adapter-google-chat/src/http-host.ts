import type { BaseApp } from "onebots";
import type { GoogleChatClient } from "./client.js";
import { GoogleChatError } from "./errors.js";

interface GoogleChatKoaContext {
    method: string;
    url: string;
    status: number;
    body: unknown;
    request: { body?: unknown };
    get(name: string): string;
    set(name: string, value: string): void;
}

/** 单一路径只注册一次；每次请求动态解析当前 Client，避免热重载捕获旧实例。 */
export class GoogleChatHttpHost {
    private readonly owners = new Map<string, string>();
    private readonly accountPaths = new Map<string, string>();
    private readonly mounted = new Set<string>();

    constructor(
        private readonly app: BaseApp,
        private readonly resolveClient: (accountId: string) => GoogleChatClient | undefined,
    ) {}

    mount(accountId: string, client: GoogleChatClient): void {
        if (client.receiveMode === "manual") return;
        const path = normalizePath(client.config.http_path || "");
        if (!path) throw GoogleChatError.invalid("HTTP 接收模式必须配置 http_path");
        const current = this.owners.get(path);
        if (current && current !== accountId && this.isActive(path, current)) {
            throw new GoogleChatError(`Google Chat HTTP 路径 ${path} 已由账号 ${current} 使用`, {
                code: "GOOGLE_CHAT_HTTP_PATH_CONFLICT",
            });
        }
        this.owners.set(path, accountId);
        this.accountPaths.set(accountId, path);
        if (this.mounted.has(path)) return;
        this.mounted.add(path);
        this.app.router.post(path, ctx => this.accept(path, ctx));
    }

    private async accept(path: string, ctx: GoogleChatKoaContext): Promise<void> {
        const owner = this.owners.get(path);
        const client = owner ? this.resolveClient(owner) : undefined;
        if (!owner || !client || !this.isActive(path, owner)) {
            ctx.status = 404;
            ctx.body = { error: { code: "NOT_FOUND", message: "Google Chat 路由未激活" } };
            return;
        }
        const response = await client.ingestHttp({
            method: ctx.method,
            url: ctx.url,
            headers: { authorization: ctx.get("authorization") || undefined },
            body: ctx.request.body,
        });
        ctx.status = response.status;
        ctx.body = response.body;
        for (const [name, value] of Object.entries(response.headers)) ctx.set(name, value);
    }

    private isActive(path: string, accountId: string): boolean {
        const client = this.resolveClient(accountId);
        return Boolean(
            client && client.receiveMode !== "manual" && this.accountPaths.get(accountId) === path,
        );
    }
}

function normalizePath(value: string): string {
    return value === "/" ? "/" : value.replace(/\/+$/u, "");
}
