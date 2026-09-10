import { GenerationConflictError } from "./generation-activation.js";
import { ConfigurationConflictError } from "../configuration/configuration-store.js";
import type { GenerationSelection } from "../installation/generation-plan.js";
import type { ControlInstallationService } from "./installation-service.js";
import { ExtensionRemovalConflictError } from "./extension-removal.js";

export function isInstallationPath(pathname: string): boolean {
    return (
        pathname === "/api/control/installations" ||
        pathname === "/api/control/updates/plan" ||
        pathname.startsWith("/api/control/installations/") ||
        pathname.startsWith("/api/control/generations/")
    );
}

interface InstallationRequest {
    pathname: string;
    method?: string;
    body(): Promise<Record<string, unknown>>;
    service?: ControlInstallationService;
    allowCredentials: boolean;
}

class InvalidRequest extends Error {}

export async function handleInstallationRequest(
    input: InstallationRequest,
): Promise<{ status: number; body: unknown }> {
    try {
        return await handle(input);
    } catch (error) {
        return {
            status:
                error instanceof GenerationConflictError ||
                error instanceof ConfigurationConflictError ||
                error instanceof ExtensionRemovalConflictError
                    ? 409
                    : error instanceof InvalidRequest
                      ? 400
                      : 500,
            body: {
                message:
                    error instanceof ExtensionRemovalConflictError
                        ? error.message
                        : error instanceof ConfigurationConflictError
                          ? "配置已变化，请刷新并重新确认安装或升级计划"
                          : error instanceof GenerationConflictError
                            ? "运行版本已变化，请刷新并重新确认安装计划"
                            : error instanceof InvalidRequest
                              ? "安装请求无效"
                              : "安装控制操作失败，请检查本地状态",
                ...(error instanceof ExtensionRemovalConflictError
                    ? { conflicts: error.conflicts }
                    : {}),
            },
        };
    }
}

async function handle(input: InstallationRequest): Promise<{ status: number; body: unknown }> {
    const { pathname, method, service } = input;
    if (!service) return { status: 503, body: { message: "安装服务不可用，请检查本地工作区" } };
    if (pathname === "/api/control/installations/catalog" && method === "GET")
        return { status: 200, body: service.catalog() };
    if (pathname === "/api/control/updates/plan" && method === "POST") {
        const body = await bodyFields(input, ["expected"]);
        const expected = body.expected;
        if (!expected || typeof expected !== "object" || Array.isArray(expected))
            throw new InvalidRequest();
        const base = expected as Record<string, unknown>;
        if (
            Object.keys(base).length !== 2 ||
            !(
                base.generationId === null ||
                (typeof base.generationId === "string" && /^[a-f0-9-]{36}$/.test(base.generationId))
            ) ||
            typeof base.configRevision !== "string" ||
            !/^[a-f0-9]{64}$/.test(base.configRevision)
        )
            throw new InvalidRequest();
        return {
            status: 200,
            body: await service.planUpdate({
                generationId: typeof base.generationId === "string" ? base.generationId : null,
                configRevision: base.configRevision,
            }),
        };
    }
    if (pathname === "/api/control/installations/plan" && method === "POST") {
        const body = await bodyFields(input, ["selection", "expectedGenerationId"]);
        if (
            !(
                body.expectedGenerationId === null ||
                (typeof body.expectedGenerationId === "string" &&
                    /^[a-f0-9-]{36}$/.test(body.expectedGenerationId))
            )
        )
            throw new InvalidRequest();
        return {
            status: 200,
            body: await service.plan(
                selection(body.selection),
                typeof body.expectedGenerationId === "string" ? body.expectedGenerationId : null,
            ),
        };
    }
    if (pathname === "/api/control/installations" && method === "POST") {
        const body = await bodyFields(input, ["id", "planId", "token"]);
        if (body.token !== undefined && !input.allowCredentials)
            return {
                status: 403,
                body: { message: "私有仓库授权仅接受本地控制连接或受保护的传输" },
            };
        if (
            typeof body.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,128}$/.test(body.id) ||
            typeof body.planId !== "string" ||
            !/^[a-f0-9]{64}$/.test(body.planId)
        )
            throw new InvalidRequest();
        const operation = service.install(
            {
                id: text(body.id),
                planId: text(body.planId),
                ...(body.token !== undefined ? { token: text(body.token) } : {}),
            },
            input.allowCredentials,
        );
        return { status: 202, body: operation };
    }
    const installation = /^\/api\/control\/installations\/([a-zA-Z0-9_-]{1,128})(\/cancel)?$/.exec(
        pathname,
    );
    if (installation && method === "GET" && !installation[2])
        return { status: 200, body: service.status(installation[1]) };
    if (installation?.[2] && method === "POST") {
        await bodyFields(input, []);
        return { status: 202, body: service.cancel(installation[1]) };
    }
    const activation = /^\/api\/control\/generations\/([a-f0-9-]{36})\/activate$/.exec(pathname);
    if (activation && method === "POST") {
        await bodyFields(input, []);
        return { status: 200, body: await service.activate(activation[1]) };
    }
    return { status: 404, body: { message: "安装控制接口不存在" } };
}

function text(value: unknown): string {
    if (typeof value !== "string" || !value.length || value.length > 512)
        throw new InvalidRequest();
    return value;
}

function selection(value: unknown): GenerationSelection {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new InvalidRequest();
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !["adapters", "protocols", "applications"].includes(key)))
        throw new InvalidRequest();
    const arrays = [input.adapters, input.protocols, input.applications];
    if (
        arrays.some(
            items =>
                !Array.isArray(items) ||
                items.length > 100 ||
                items.some(
                    item => typeof item !== "string" || item.length < 1 || item.length > 128,
                ),
        )
    )
        throw new InvalidRequest();
    return {
        adapters: [...(input.adapters as string[])],
        protocols: [...(input.protocols as string[])],
        applications: [...(input.applications as string[])],
    };
}

async function bodyFields(
    input: InstallationRequest,
    allowed: string[],
): Promise<Record<string, unknown>> {
    try {
        const body = await input.body();
        if (
            !body ||
            typeof body !== "object" ||
            Array.isArray(body) ||
            Object.keys(body).some(key => !allowed.includes(key))
        )
            throw new InvalidRequest();
        return body;
    } catch {
        throw new InvalidRequest();
    }
}
