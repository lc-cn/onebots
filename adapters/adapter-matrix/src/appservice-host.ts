import type { BaseApp, RouterRegistrationScope } from "onebots";
import type { MatrixClient } from "./client.js";
import { MatrixError } from "./errors.js";
import { matrixErrorResponse } from "./http.js";

interface MatrixKoaContext {
    method: string;
    url: string;
    status: number;
    body: unknown;
    request: { body?: unknown };
    get(name: string): string;
    set(name: string, value: string): void;
}

/**
 * 每个挂载路径只注册一次路由，请求时再解析当前账号 Client。
 * 这样热重载不会让 Koa 路由永久捕获已停止的旧连接。
 */
export class MatrixAppserviceHost {
    private readonly owners = new Map<string, string>();
    private readonly accountRoots = new Map<string, string>();
    private readonly mounted = new Map<string, RouterRegistrationScope>();

    constructor(
        private readonly app: BaseApp,
        private readonly resolveClient: (accountId: string) => MatrixClient | undefined,
    ) {}

    mount(accountId: string, client: MatrixClient, accountPath: string): void {
        const root = normalizeRoot(client.config.appservice_path || `${accountPath}/appservice`);
        const currentOwner = this.owners.get(root);
        if (currentOwner && currentOwner !== accountId && this.isActive(root, currentOwner)) {
            throw new MatrixError(
                `Matrix AppService 路径 ${root || "/"} 已由账号 ${currentOwner} 使用`,
                { code: "MATRIX_APPSERVICE_PATH_CONFLICT" },
            );
        }
        if (this.accountRoots.get(accountId) !== root) this.unmount(accountId);
        this.owners.set(root, accountId);
        this.accountRoots.set(accountId, root);
        if (this.mounted.has(root)) return;
        const scope = this.app.router.createRegistrationScope();
        this.mounted.set(root, scope);
        scope.run(() => {
            this.app.router.put(`${root}/_matrix/app/v1/transactions/:txnId`, ctx =>
                this.accept(root, ctx),
            );
            this.app.router.post(`${root}/_matrix/app/v1/ping`, ctx => this.accept(root, ctx));
            this.app.router.get(`${root}/_matrix/app/v1/users/:userId`, ctx =>
                this.accept(root, ctx),
            );
            this.app.router.get(`${root}/_matrix/app/v1/rooms/:roomAlias`, ctx =>
                this.accept(root, ctx),
            );
        });
    }

    /** 移除账号及其 HTTP layer，迟到请求不保留旧客户端。 */
    unmount(accountId: string): void {
        const root = this.accountRoots.get(accountId);
        this.accountRoots.delete(accountId);
        if (root === undefined || this.owners.get(root) !== accountId) return;
        this.owners.delete(root);
        this.mounted.get(root)?.close();
        this.mounted.delete(root);
    }

    private async accept(root: string, ctx: MatrixKoaContext): Promise<void> {
        const owner = this.owners.get(root);
        const client = owner ? this.resolveClient(owner) : undefined;
        if (!owner || !client || !this.isActive(root, owner)) {
            const response = matrixErrorResponse(
                404,
                "M_UNRECOGNIZED",
                "Matrix AppService 路由未激活",
            );
            ctx.status = response.status;
            ctx.body = response.body;
            for (const [name, value] of Object.entries(response.headers)) ctx.set(name, value);
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

    private isActive(root: string, accountId: string): boolean {
        const client = this.resolveClient(accountId);
        if (!client || client.receiveMode !== "appservice") return false;
        return this.accountRoots.get(accountId) === root;
    }
}

function normalizeRoot(value: string): string {
    return value === "/" ? "" : value.replace(/\/+$/u, "");
}
