import type { PlatformActionHandler } from "onebots";
import type { TeamsBot } from "./bot.js";
import { TeamsApiError } from "./errors.js";
import {
    objectValue,
    optionalString,
    requireString,
    scalarObject,
    type TeamsActionParams,
} from "./platform-action-params.js";

/** 安全的 Microsoft Graph app-only 原生入口。 */
export const TEAMS_GRAPH_ACTIONS = {
    call_graph_api: callGraph,
} satisfies Readonly<Record<string, PlatformActionHandler<TeamsBot>>>;

async function callGraph(bot: TeamsBot, params: TeamsActionParams): Promise<unknown> {
    const path = requireGraphPath(params.path);
    const method = (optionalString(params.method)?.toUpperCase() || "GET") as
        | "GET"
        | "POST"
        | "PATCH"
        | "PUT"
        | "DELETE";
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        throw TeamsApiError.invalid(
            `Teams Graph method 不受支持: ${method}`,
            "TEAMS_GRAPH_METHOD_INVALID",
        );
    }
    const query = params.query == null ? undefined : scalarObject(params.query, "query");
    const body = ["POST", "PATCH", "PUT"].includes(method)
        ? params.body == null
            ? undefined
            : objectValue(params.body, "body")
        : undefined;
    return bot.callGraphApi(path, { method, query, body });
}

function requireGraphPath(value: unknown): string {
    const path = requireString(value, "path");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
        throw TeamsApiError.invalid(
            "Teams Graph path 必须是安全的 API 相对路径",
            "TEAMS_GRAPH_PATH_INVALID",
        );
    }
    return path;
}
