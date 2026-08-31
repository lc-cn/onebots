import { ValidationError } from "@onebots/core";
import {
    saveManagedRuntimeConfig,
    reloadManagedRuntimeConfig,
    type ManagedRuntimeConfigHost,
    type ManagedRuntimeConfigResult,
} from "./managed-runtime-config.js";
import { RuntimeConfigApplicationConflictError } from "./runtime-config-application.js";

export interface ManagementConfigSocketRequest {
    action?: unknown;
    data?: unknown;
    echo?: unknown;
}

export type ManagementConfigErrorCode =
    | "CONFIG_CONFLICT"
    | "CONFIG_INVALID"
    | "CONFIG_APPLY_FAILED";

export interface ManagementConfigSocketResponse {
    event: "system.config.result";
    echo?: unknown;
    data:
        | ManagedRuntimeConfigResult
        | { success: false; code: ManagementConfigErrorCode; message: string };
}

/** 处理旧管理 WebSocket 的配置动作，并始终返回可关联的机器回执。 */
export async function handleManagementConfigSocketAction(
    host: ManagedRuntimeConfigHost,
    request: ManagementConfigSocketRequest,
    configPath?: string,
): Promise<ManagementConfigSocketResponse | undefined> {
    if (request.action !== "system.saveConfig" && request.action !== "system.reload") {
        return undefined;
    }

    try {
        const data =
            request.action === "system.saveConfig"
                ? await saveManagedRuntimeConfig(host, String(request.data), configPath)
                : await reloadManagedRuntimeConfig(host, configPath);
        return response(request, data);
    } catch (error) {
        return response(request, {
            success: false,
            code:
                error instanceof RuntimeConfigApplicationConflictError
                    ? "CONFIG_CONFLICT"
                    : error instanceof ValidationError
                      ? "CONFIG_INVALID"
                      : "CONFIG_APPLY_FAILED",
            message: error instanceof Error ? error.message : String(error),
        });
    }
}

function response(
    request: ManagementConfigSocketRequest,
    data: ManagementConfigSocketResponse["data"],
): ManagementConfigSocketResponse {
    return request.echo === undefined
        ? { event: "system.config.result", data }
        : { event: "system.config.result", echo: request.echo, data };
}
