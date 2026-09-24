import type { ControlConfigurationSnapshot } from "@onebots/core/control";

export interface ControlConnectionEndpoint {
    id: string;
    label: string;
    url: string;
    purpose: string;
    transport: "http" | "websocket" | "sse";
}

export interface ControlReverseTarget {
    label: string;
    count: number;
}

export interface ControlConnectionGuide {
    id: string;
    platform: string;
    accountId: string;
    protocolKey: string;
    protocolLabel: string;
    category: "protocol" | "ai";
    endpoints: ControlConnectionEndpoint[];
    reverseTargets: ControlReverseTarget[];
    authConfigured: boolean;
    instructions: string[];
    warning?: string;
}

type JsonRecord = Record<string, unknown>;

const protocolLabels: Record<string, string> = {
    "onebot.v11": "OneBot 11",
    "onebot.v12": "OneBot 12",
    "satori.v1": "Satori v1",
    "milky.v1": "Milky v1",
    "mcp.v1": "MCP v1",
};

const record = (value: unknown): JsonRecord =>
    value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};

function booleanSetting(config: JsonRecord, schema: JsonRecord, key: string): boolean {
    if (typeof config[key] === "boolean") return config[key];
    const rule = record(schema[key]);
    return rule.default === true;
}

function routeFor(platform: string, accountId: string, protocolKey: string): string {
    const separator = protocolKey.lastIndexOf(".");
    const protocol = separator > 0 ? protocolKey.slice(0, separator) : protocolKey;
    const version = separator > 0 ? protocolKey.slice(separator + 1) : "v1";
    return `/${encodeURIComponent(platform)}/${encodeURIComponent(accountId)}/${encodeURIComponent(protocol)}/${encodeURIComponent(version)}`;
}

function reverseCount(config: JsonRecord, key: string): number {
    const value = config[key];
    return Array.isArray(value) ? value.length : 0;
}

function hasSecret(
    snapshot: ControlConfigurationSnapshot,
    accountKey: string,
    protocolKey: string,
    fields: string[],
): boolean {
    return snapshot.secretStates.some(
        state =>
            state.configured &&
            fields.includes(state.path.at(-1) ?? "") &&
            ((state.path[0] === accountKey && state.path[1] === protocolKey) ||
                (state.path[0] === "general" && state.path[1] === protocolKey)),
    );
}

function endpointsFor(
    protocolKey: string,
    path: string,
    httpOrigin: string,
    wsOrigin: string,
    useHttp: boolean,
    useWs: boolean,
): ControlConnectionEndpoint[] {
    const endpoint = (
        id: string,
        label: string,
        url: string,
        purpose: string,
        transport: ControlConnectionEndpoint["transport"],
    ): ControlConnectionEndpoint => ({ id, label, url, purpose, transport });
    if (protocolKey === "mcp.v1")
        return [
            endpoint(
                "sse",
                "SSE 入口",
                `${httpOrigin}${path}/sse`,
                "填写到支持旧版 HTTP + SSE 传输的 MCP 客户端",
                "sse",
            ),
        ];

    const entries: ControlConnectionEndpoint[] = [];
    if (useHttp) {
        const suffix = protocolKey === "milky.v1" ? "/api" : "";
        entries.push(
            endpoint(
                "http",
                "HTTP API 根地址",
                `${httpOrigin}${path}${suffix}`,
                protocolKey === "milky.v1"
                    ? "下游会在该地址后追加 Milky API 动作"
                    : "下游会在该地址后追加 API 动作",
                "http",
            ),
        );
    }
    if (useWs) {
        const suffix =
            protocolKey === "satori.v1" ? "/events" : protocolKey === "milky.v1" ? "/event" : "";
        entries.push(
            endpoint(
                "websocket",
                protocolKey === "satori.v1" || protocolKey === "milky.v1"
                    ? "事件 WebSocket"
                    : "正向 WebSocket",
                `${wsOrigin}${path}${suffix}`,
                "粘贴到下游框架的正向 WebSocket、事件地址或服务端地址",
                "websocket",
            ),
        );
    }
    return entries;
}

function instructionsFor(
    protocolKey: string,
    useHttp: boolean,
    useWs: boolean,
    reverse: ControlReverseTarget[],
): string[] {
    if (protocolKey === "mcp.v1")
        return ["在 AI 客户端中新增 MCP 服务。", "选择 HTTP + SSE 传输并粘贴 SSE 入口。"];
    const steps = [`在下游应用中选择 ${protocolLabels[protocolKey] ?? protocolKey}。`];
    if (useWs) steps.push("选择正向 WebSocket，并粘贴下方 WebSocket 地址。");
    else if (useHttp) steps.push("填写下方 HTTP API 根地址，用它调用机器人 API。");
    if (reverse.length)
        steps.push("反向目标已经写入配置，OneBots 启动后会主动连接，无需复制本机地址。");
    steps.push("如果配置过 Token，在下游填写同一个 Token；管理端不会回显密钥。");
    return steps;
}

export function normalizeConnectionOrigin(value: string): string | undefined {
    try {
        const url = new URL(value.trim());
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
            return undefined;
        return url.origin;
    } catch {
        return undefined;
    }
}

export function buildControlConnectionGuides(
    snapshot: ControlConfigurationSnapshot | undefined,
    origin: string,
): ControlConnectionGuide[] {
    const httpOrigin = normalizeConnectionOrigin(origin);
    if (!snapshot || !httpOrigin) return [];
    const wsOrigin = httpOrigin.replace(/^http/, "ws");
    const schemas = record(snapshot.schemas);
    const adapterSchemas = record(schemas.adapters);
    const protocolSchemas = record(schemas.protocols);
    const general = record(snapshot.document.general);
    const adapterNames = Object.keys(adapterSchemas).sort(
        (left, right) => right.length - left.length,
    );
    const protocolKeys = Object.keys(protocolSchemas);
    const guides: ControlConnectionGuide[] = [];

    for (const [accountKey, accountValue] of Object.entries(snapshot.document)) {
        const platform = adapterNames.find(name => accountKey.startsWith(`${name}.`));
        if (!platform) continue;
        const accountId = accountKey.slice(platform.length + 1);
        const account = record(accountValue);
        for (const protocolKey of protocolKeys) {
            if (!Object.hasOwn(account, protocolKey)) continue;
            const protocolSchema = record(protocolSchemas[protocolKey]);
            const config = {
                ...record(general[protocolKey]),
                ...record(account[protocolKey]),
            };
            const useHttp = booleanSetting(config, protocolSchema, "use_http");
            const useWs = booleanSetting(config, protocolSchema, "use_ws");
            const reverseTargets = [
                { label: "HTTP 反向上报", count: reverseCount(config, "http_reverse") },
                { label: "HTTP Webhook", count: reverseCount(config, "http_webhook") },
                { label: "Webhook", count: reverseCount(config, "webhooks") },
                { label: "反向 WebSocket", count: reverseCount(config, "ws_reverse") },
            ].filter(target => target.count > 0);
            const path = routeFor(platform, accountId, protocolKey);
            const endpoints = endpointsFor(protocolKey, path, httpOrigin, wsOrigin, useHttp, useWs);
            let warning: string | undefined;
            if (!endpoints.length && !reverseTargets.length)
                warning =
                    "协议已经添加，但没有启用正向入口或配置反向目标。请返回账号与协议开启连接方式。";
            else if (useHttp && !useWs && !reverseTargets.length && protocolKey !== "mcp.v1")
                warning =
                    "HTTP API 只负责接收调用。要让下游实时收到事件，请启用 WebSocket，或配置 Webhook / 反向 WebSocket。";
            guides.push({
                id: `${accountKey}:${protocolKey}`,
                platform,
                accountId,
                protocolKey,
                protocolLabel: protocolLabels[protocolKey] ?? protocolKey,
                category: protocolKey === "mcp.v1" ? "ai" : "protocol",
                endpoints,
                reverseTargets,
                authConfigured: hasSecret(snapshot, accountKey, protocolKey, [
                    "access_token",
                    "token",
                ]),
                instructions: instructionsFor(protocolKey, useHttp, useWs, reverseTargets),
                ...(warning ? { warning } : {}),
            });
        }
    }
    return guides.sort((left, right) => left.id.localeCompare(right.id));
}
