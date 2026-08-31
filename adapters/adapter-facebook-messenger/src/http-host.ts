import type { BaseApp } from "onebots";
import type { FacebookMessengerClient } from "./client.js";
import { FacebookMessengerError } from "./errors.js";

interface MessengerKoaContext {
    method: string;
    url: string;
    status: number;
    body: unknown;
    request: { rawBody?: string | Uint8Array };
    get(name: string): string;
    set(name: string, value: string): void;
}

/** 路径只注册一次，热重载时动态解析当前 Client，且始终传递签名覆盖的原始体。 */
export class FacebookMessengerHttpHost {
    private readonly owners = new Map<string, string>();
    private readonly accountPaths = new Map<string, string>();
    private readonly mounted = new Set<string>();

    constructor(
        private readonly app: BaseApp,
        private readonly resolveClient: (accountId: string) => FacebookMessengerClient | undefined,
    ) {}

    mount(accountId: string, client: FacebookMessengerClient): void {
        if (client.receiveMode === "manual") return;
        const path = normalizePath(client.config.http_path || "");
        if (!path) throw FacebookMessengerError.invalid("webhook 模式必须配置 http_path");
        const current = this.owners.get(path);
        if (current && current !== accountId && this.isActive(path, current)) {
            throw new FacebookMessengerError(
                `Facebook Messenger HTTP 路径 ${path} 已由账号 ${current} 使用`,
                { code: "FACEBOOK_MESSENGER_HTTP_PATH_CONFLICT" },
            );
        }
        this.owners.set(path, accountId);
        this.accountPaths.set(accountId, path);
        if (this.mounted.has(path)) return;
        this.mounted.add(path);
        this.app.router.get(path, ctx => this.accept(path, ctx));
        this.app.router.post(path, ctx => this.accept(path, ctx));
    }

    private async accept(path: string, ctx: MessengerKoaContext): Promise<void> {
        const owner = this.owners.get(path);
        const client = owner ? this.resolveClient(owner) : undefined;
        if (!owner || !client || !this.isActive(path, owner)) {
            ctx.status = 404;
            ctx.body = {
                error: { code: "NOT_FOUND", message: "Facebook Messenger 路由未激活" },
            };
            return;
        }
        const raw = ctx.request.rawBody;
        const response = await client.ingestHttp({
            method: ctx.method,
            url: ctx.url,
            headers: { "x-hub-signature-256": ctx.get("x-hub-signature-256") || undefined },
            rawBody:
                typeof raw === "string"
                    ? new TextEncoder().encode(raw)
                    : raw instanceof Uint8Array
                      ? new Uint8Array(raw)
                      : undefined,
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
