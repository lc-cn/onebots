import { randomBytes } from "node:crypto";
import type { RouterContext } from "onebots";

const ROUTE = "/_onebots/douyin-verification";
const SESSION_TTL_MS = 5 * 60 * 1000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const KEY_PATTERN = /^[0-9a-f]{64}$/u;

interface VerificationSession {
    accountId: string;
    type: string;
    upstream: URL;
    expiresAt: number;
}

export class DouyinVerificationProxy {
    private readonly sessions = new Map<string, VerificationSession>();
    private readonly routePrefix: string;

    constructor(
        app: {
            config: { path: string };
            router: { all(path: string, handler: (ctx: RouterContext) => Promise<void>): unknown };
        },
        private readonly now: () => number = Date.now,
    ) {
        const gatewayPrefix = normalizeGatewayPrefix(app.config.path);
        this.routePrefix = `${gatewayPrefix}${ROUTE}`;
        app.router.all(`${ROUTE}/:key`, ctx => this.accept(ctx));
        app.router.all(`${ROUTE}/:key/{*path}`, ctx => this.accept(ctx));
    }

    publish(accountId: string, type: string, localUrl: string): string {
        const upstream = localVerificationUrl(localUrl);
        this.revoke(accountId, type);
        this.expire();
        const key = randomBytes(32).toString("hex");
        this.sessions.set(key, {
            accountId,
            type,
            upstream,
            expiresAt: this.now() + SESSION_TTL_MS,
        });
        return `${this.routePrefix}/${key}`;
    }

    revoke(accountId: string, type?: string): void {
        for (const [key, session] of this.sessions) {
            if (session.accountId === accountId && (!type || session.type === type)) {
                this.sessions.delete(key);
            }
        }
    }

    private async accept(ctx: RouterContext): Promise<void> {
        this.expire();
        const requestPath = stripGatewayPrefix(ctx.path, this.routePrefix);
        const [key, ...segments] = requestPath.split("/");
        const session = KEY_PATTERN.test(key ?? "") ? this.sessions.get(key!) : undefined;
        if (!session) {
            ctx.status = 404;
            ctx.body = "抖音验证页面已失效，请返回 OneBots 重新发起验证";
            return;
        }
        const target = new URL(`/${segments.join("/")}${queryPart(ctx.url)}`, session.upstream);
        target.searchParams.set("token", session.upstream.searchParams.get("token")!);
        const method = ctx.method.toUpperCase();
        const body = requestBody(ctx, method);
        const response = await fetch(target, {
            method,
            headers: proxyRequestHeaders(ctx.headers),
            redirect: "manual",
            ...(body === undefined ? {} : { body }),
        });
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > MAX_RESPONSE_BYTES) {
            ctx.status = 502;
            ctx.body = "抖音验证页面响应过大";
            return;
        }
        ctx.status = response.status;
        for (const [name, value] of response.headers) {
            if (proxyResponseHeader(name)) ctx.set(name, value);
        }
        ctx.set("Cache-Control", "no-store");
        ctx.set("Referrer-Policy", "no-referrer");
        ctx.set("X-Content-Type-Options", "nosniff");
        const contentType = response.headers.get("content-type") ?? "";
        ctx.body = contentType.includes("text/html")
            ? rewriteVerificationHtml(new TextDecoder().decode(bytes), `${this.routePrefix}/${key}`)
            : Buffer.from(bytes);
    }

    private expire(): void {
        const now = this.now();
        for (const [key, session] of this.sessions) {
            if (session.expiresAt <= now) this.sessions.delete(key);
        }
    }
}

export function rewriteVerificationHtml(html: string, publicPrefix: string): string {
    const route = publicPrefix.replace(/\/$/u, "");
    return html
        .replace(
            /(["'])\/(react(?:-dom)?\.js|api\/(?:request|send-code|submit-code|complete|cancel))/gu,
            `$1${route}/$2`,
        )
        .replace("; path=/';", `; path=${route}/';`);
}

function localVerificationUrl(value: string): URL {
    const url = new URL(value);
    if (
        url.protocol !== "http:" ||
        url.hostname !== "127.0.0.1" ||
        !url.port ||
        url.pathname !== "/" ||
        url.username ||
        url.password ||
        [...url.searchParams.keys()].some(key => key !== "token") ||
        !url.searchParams.get("token")
    ) {
        throw new Error("抖音验证页地址不是受支持的本机挑战地址");
    }
    return url;
}

function normalizeGatewayPrefix(value: string): string {
    const normalized = value.trim().replace(/^\/+|\/+$/gu, "");
    return normalized ? `/${normalized}` : "";
}

function stripGatewayPrefix(pathname: string, routePrefix: string): string {
    return pathname.startsWith(`${routePrefix}/`) ? pathname.slice(routePrefix.length + 1) : "";
}

function queryPart(url: string): string {
    const index = url.indexOf("?");
    return index < 0 ? "" : url.slice(index);
}

function requestBody(ctx: RouterContext, method: string): BodyInit | undefined {
    if (method === "GET" || method === "HEAD") return undefined;
    const raw = (ctx.request as RouterContext["request"] & { rawBody?: unknown }).rawBody;
    if (typeof raw === "string") return raw;
    if (Buffer.isBuffer(raw)) return raw;
    return undefined;
}

function proxyRequestHeaders(headers: RouterContext["headers"]): Headers {
    const result = new Headers();
    const allowed = new Set(["accept", "accept-language", "content-type", "user-agent"]);
    for (const [name, value] of Object.entries(headers)) {
        if (!value || !allowed.has(name.toLowerCase())) continue;
        result.set(name, Array.isArray(value) ? value.join(", ") : value);
    }
    return result;
}

function proxyResponseHeader(name: string): boolean {
    return !/^(?:connection|content-length|content-encoding|location|set-cookie|transfer-encoding)$/iu.test(
        name,
    );
}
