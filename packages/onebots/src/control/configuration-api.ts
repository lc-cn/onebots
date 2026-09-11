import {
    ConfigurationConflictError,
    type ConfigurationBase,
} from "../configuration/configuration-store.js";
import {
    parseConfigurationDocument,
    type ConfigurationChange,
    type SecretChange,
} from "../configuration/configuration-document.js";

/** 此接口只接收已投影服务，不得把私有草稿库或原始配置文件直接作为 service。 */
export interface ConfigurationApiService {
    snapshot(): Promise<unknown>;
    sourceState(): unknown;
    createRepair(base: ConfigurationBase): Promise<unknown>;
    readContext(id: string): Promise<unknown>;
    create(base: ConfigurationBase): Promise<unknown>;
    read(id: string): Promise<unknown>;
    edit(input: {
        id: string;
        expectedRevision: string;
        changes: ConfigurationChange[];
        secrets: SecretChange[];
    }): Promise<unknown>;
    addAccount(input: {
        id: string;
        expectedRevision: string;
        platform: string;
        accountId: string;
    }): Promise<unknown>;
    editList(input: {
        id: string;
        expectedRevision: string;
        path: string[];
        action: "append" | "remove";
        index?: number;
    }): Promise<unknown>;
    validate(input: { id: string; expectedRevision: string }): Promise<unknown>;
    removeAccount(input: {
        id: string;
        expectedRevision: string;
        accountKey: string;
    }): Promise<unknown>;
    setProtocol(input: {
        id: string;
        expectedRevision: string;
        accountKey: string | null;
        protocol: string;
        enabled: boolean;
    }): Promise<unknown>;
    apply(input: { id: string; receiptId: string }): Promise<unknown>;
    reconcile(input: { id: string; expectedRevision: string }): Promise<unknown>;
    operation(id: string): unknown;
}
interface ConfigurationRequest {
    pathname: string;
    method?: string;
    body(): Promise<Record<string, unknown>>;
    service?: ConfigurationApiService;
    allowCredentials: boolean;
    local?: boolean;
}
const ROOT = "/api/control/configuration";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9_-]{1,128}$/;
class InvalidRequest extends Error {}
function invalid(): never {
    throw new InvalidRequest();
}
export function isConfigurationPath(pathname: string): boolean {
    return pathname === ROOT || pathname.startsWith(`${ROOT}/`);
}

/** 鉴权由管理 host 完成；这里只做路由、传输授权和闭合请求契约。 */
export async function handleConfigurationRequest(
    input: ConfigurationRequest,
): Promise<{ status: number; body: unknown }> {
    try {
        return await handle(input);
    } catch (error) {
        return {
            status: error instanceof ConfigurationConflictError ? 409 : 400,
            body: {
                message:
                    error instanceof ConfigurationConflictError
                        ? "配置已发生变化，请重新读取后操作"
                        : "配置请求失败，请检查本地状态",
            },
        };
    }
}
async function handle(input: ConfigurationRequest): Promise<{ status: number; body: unknown }> {
    const { service, pathname, method } = input;
    if (!service) return { status: 503, body: { message: "配置服务不可用，请检查本地工作区" } };
    if (pathname === `${ROOT}/reconcile` && method === "POST") {
        if (input.local !== true)
            return { status: 403, body: { message: "中断修复仅允许通过本地控制连接对账" } };
        const body = await fields(input, ["id", "expectedRevision"]);
        if (!matches(body.id, ID) || !matches(body.expectedRevision, HASH)) invalid();
        return {
            status: 200,
            body: await service.reconcile({
                id: body.id as string,
                expectedRevision: body.expectedRevision as string,
            }),
        };
    }
    if (pathname === `${ROOT}/source` && method === "GET")
        return { status: 200, body: await service.sourceState() };
    if (pathname === `${ROOT}/repair-drafts` && method === "POST") {
        const body = await fields(input, ["base", "strategy"]);
        const base = objectFields(body.base, ["generationId", "configRevision"]);
        if (
            body.strategy !== "new-empty" ||
            !(base.generationId === null || matches(base.generationId, UUID)) ||
            !matches(base.configRevision, HASH)
        )
            invalid();
        return {
            status: 201,
            body: await service.createRepair(base as unknown as ConfigurationBase),
        };
    }
    if (pathname === ROOT && method === "GET")
        return { status: 200, body: await service.snapshot() };
    if (pathname === `${ROOT}/drafts` && method === "POST") {
        const body = await fields(input, ["base"]);
        const base = objectFields(body.base, ["generationId", "configRevision"]);
        if (
            !(base.generationId === null || matches(base.generationId, UUID)) ||
            !matches(base.configRevision, HASH)
        )
            invalid();
        return { status: 201, body: await service.create(base as unknown as ConfigurationBase) };
    }
    if (pathname === `${ROOT}/apply` && method === "POST") {
        const body = await fields(input, ["id", "receiptId"]);
        if (!matches(body.id, ID) || !matches(body.receiptId, UUID)) invalid();
        return {
            status: 202,
            body: await service.apply({
                id: body.id as string,
                receiptId: body.receiptId as string,
            }),
        };
    }
    const suffix = pathname.slice(ROOT.length);
    const operation = /^\/operations\/([A-Za-z0-9_-]{1,128})$/.exec(suffix);
    if (isConfigurationPath(pathname) && operation && method === "GET") {
        const result = await service.operation(operation[1]);
        return result === undefined
            ? { status: 404, body: { message: "配置操作不存在" } }
            : { status: 200, body: result };
    }
    const draft =
        /^\/drafts\/([^/]+)(?:\/(edit|accounts|validate|remove-account|protocol|list|context))?$/.exec(
            suffix,
        );
    if (!isConfigurationPath(pathname) || !draft)
        return { status: 404, body: { message: "配置控制接口不存在" } };
    if (!UUID.test(draft[1])) invalid();
    const id = draft[1];
    if (draft[2] === "context" && method === "GET")
        return { status: 200, body: await service.readContext(id) };
    if (!draft[2] && method === "GET") return { status: 200, body: await service.read(id) };
    if (method !== "POST") return { status: 404, body: { message: "配置控制接口不存在" } };
    if (draft[2] === "list") {
        const body = parseConfigurationDocument(await input.body());
        objectFields(
            body,
            body.action === "append"
                ? ["expectedRevision", "path", "action"]
                : ["expectedRevision", "path", "action", "index"],
        );
        if (
            !matches(body.expectedRevision, HASH) ||
            !["append", "remove"].includes(String(body.action)) ||
            !Array.isArray(body.path) ||
            !body.path.length ||
            body.path.length > 64 ||
            body.path.some(
                part =>
                    typeof part !== "string" ||
                    !part ||
                    ["__proto__", "constructor", "prototype"].includes(part),
            ) ||
            (body.action === "remove" &&
                (typeof body.index !== "number" ||
                    !Number.isSafeInteger(body.index) ||
                    body.index < 0))
        )
            invalid();
        return {
            status: 200,
            body: await service.editList({
                id,
                expectedRevision: body.expectedRevision as string,
                path: body.path as string[],
                action: body.action as "append" | "remove",
                ...(body.action === "remove" ? { index: body.index as number } : {}),
            }),
        };
    }
    if (draft[2] === "remove-account") {
        const body = await fields(input, ["expectedRevision", "accountKey"]);
        if (
            !matches(body.expectedRevision, HASH) ||
            typeof body.accountKey !== "string" ||
            body.accountKey.length > 512
        )
            invalid();
        return {
            status: 200,
            body: await service.removeAccount({
                id,
                expectedRevision: body.expectedRevision as string,
                accountKey: body.accountKey as string,
            }),
        };
    }
    if (draft[2] === "protocol") {
        const body = await fields(input, ["expectedRevision", "accountKey", "protocol", "enabled"]);
        if (
            !matches(body.expectedRevision, HASH) ||
            !(body.accountKey === null || typeof body.accountKey === "string") ||
            typeof body.protocol !== "string" ||
            body.protocol.length > 256 ||
            typeof body.enabled !== "boolean"
        )
            invalid();
        return {
            status: 200,
            body: await service.setProtocol({
                id,
                expectedRevision: body.expectedRevision as string,
                accountKey: body.accountKey as string | null,
                protocol: body.protocol as string,
                enabled: body.enabled as boolean,
            }),
        };
    }
    if (draft[2] === "edit") {
        const body = await fields(input, ["expectedRevision", "changes", "secrets"]);
        if (!matches(body.expectedRevision, HASH)) invalid();
        const changes = edits(body.changes, false) as ConfigurationChange[];
        const secrets = edits(body.secrets, true) as SecretChange[];
        if (!input.allowCredentials && secrets.some(change => change.op === "set"))
            return { status: 403, body: { message: "配置秘密仅接受本地控制连接或受保护的传输" } };
        return {
            status: 200,
            body: await service.edit({
                id,
                expectedRevision: body.expectedRevision as string,
                changes,
                secrets,
            }),
        };
    }
    if (draft[2] === "accounts") {
        const body = await fields(input, ["expectedRevision", "platform", "accountId"]);
        if (
            !matches(body.expectedRevision, HASH) ||
            !matches(body.platform, /^[A-Za-z0-9_-]{1,128}$/) ||
            typeof body.accountId !== "string" ||
            !body.accountId.length ||
            body.accountId.length > 512 ||
            /[\u0000-\u001f\u007f]/.test(body.accountId)
        )
            invalid();
        return {
            status: 200,
            body: await service.addAccount({
                id,
                expectedRevision: body.expectedRevision as string,
                platform: body.platform as string,
                accountId: body.accountId,
            }),
        };
    }
    if (draft[2] === "validate") {
        const body = await fields(input, ["expectedRevision"]);
        if (!matches(body.expectedRevision, HASH)) invalid();
        return {
            status: 200,
            body: await service.validate({ id, expectedRevision: body.expectedRevision as string }),
        };
    }
    return { status: 404, body: { message: "配置控制接口不存在" } };
}
function matches(value: unknown, pattern: RegExp): value is string {
    return typeof value === "string" && pattern.test(value);
}
function objectFields(value: unknown, allowed: string[]): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
    const keys = Object.keys(value);
    if (keys.length !== allowed.length || keys.some(key => !allowed.includes(key))) invalid();
    return value as Record<string, unknown>;
}
async function fields(
    input: ConfigurationRequest,
    allowed: string[],
): Promise<Record<string, unknown>> {
    return objectFields(parseConfigurationDocument(await input.body()), allowed);
}
function edits(input: unknown, secret: boolean): Array<ConfigurationChange | SecretChange> {
    if (!Array.isArray(input) || input.length > 1000) invalid();
    return input.map(value => {
        if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
        const entry = value as Record<string, unknown>;
        if (!(secret ? ["set", "keep", "clear"] : ["set", "remove"]).includes(String(entry.op)))
            invalid();
        objectFields(entry, entry.op === "set" ? ["op", "path", "value"] : ["op", "path"]);
        if (
            !Array.isArray(entry.path) ||
            !entry.path.length ||
            entry.path.length > 64 ||
            entry.path.some(
                part =>
                    typeof part !== "string" ||
                    !part.length ||
                    ["__proto__", "constructor", "prototype"].includes(part),
            )
        )
            invalid();
        return entry as unknown as ConfigurationChange | SecretChange;
    });
}
