import {
    ErrorHandler,
    UnsupportedCapabilityError,
    ValidationError,
    type Account,
    type BaseApp,
} from "@onebots/core";

export type ManagementAccountLifecycleAction = "bot.start" | "bot.stop";
export type ManagementAccountLifecycleErrorCode =
    | "ACCOUNT_REQUEST_INVALID"
    | "ACCOUNT_TARGET_NOT_FOUND"
    | "ACCOUNT_LIFECYCLE_CONFLICT"
    | "ACCOUNT_LIFECYCLE_UNSUPPORTED"
    | "ACCOUNT_LIFECYCLE_FAILED";

export type ManagementAccountLifecycleResult =
    | { success: true; account: Account["info"] }
    | {
          success: false;
          status: 400 | 404 | 409 | 500 | 501;
          code: ManagementAccountLifecycleErrorCode;
          message: string;
      };

export interface ManagementAccountLifecycleSocketRequest {
    action?: unknown;
    data?: unknown;
    echo?: unknown;
}

export type ManagementAccountLifecycleSocketResponse =
    | { event: "bot.change"; echo?: unknown; data: Account["info"] }
    | {
          event: "bot.change.result";
          echo?: unknown;
          data: {
              success: false;
              action: ManagementAccountLifecycleAction;
              code: ManagementAccountLifecycleErrorCode;
              message: string;
          };
      };

type ManagementAccountLifecycleHost = Pick<BaseApp, "adapters" | "logger">;
const activeOperations = new WeakMap<
    ManagementAccountLifecycleHost,
    Map<string, ManagementAccountLifecycleAction>
>();

/** HTTP 与旧管理 WebSocket 共用的账号生命周期执行边界。 */
export async function executeManagementAccountLifecycle(
    host: ManagementAccountLifecycleHost,
    action: ManagementAccountLifecycleAction,
    data: unknown,
): Promise<ManagementAccountLifecycleResult> {
    try {
        const request = parseRequest(data);
        const platform = requiredString("platform", request.platform);
        const uin = requiredString("uin", request.uin);
        const adapter = host.adapters.get(platform);
        if (!adapter) throw new AccountLifecycleTargetNotFoundError(`适配器 ${platform} 不存在`);
        const account = adapter.getAccount(uin);
        if (!account) {
            throw new AccountLifecycleTargetNotFoundError(`账号 ${platform}.${uin} 不存在`);
        }

        await runAccountLifecycleOperation(host, platform, uin, action, async () => {
            if (action === "bot.start") await adapter.setOnline(uin);
            else await adapter.setOffline(uin);
        });
        return { success: true, account: account.info };
    } catch (error) {
        host.logger.error(
            `管理端账号${action === "bot.start" ? "上线" : "下线"}操作失败`,
            ErrorHandler.wrap(error, { action }),
        );
        return classifyLifecycleError(error);
    }
}

/** 兼容旧 WebSocket 成功事件，同时让失败始终获得带 echo 的机器回执。 */
export async function handleManagementAccountLifecycleSocketAction(
    host: ManagementAccountLifecycleHost,
    request: ManagementAccountLifecycleSocketRequest,
): Promise<ManagementAccountLifecycleSocketResponse | undefined> {
    if (request.action !== "bot.start" && request.action !== "bot.stop") return undefined;
    const result = await executeManagementAccountLifecycle(host, request.action, request.data);
    if (result.success === true) {
        return withEcho(request.echo, { event: "bot.change", data: result.account });
    }
    return withEcho(request.echo, {
        event: "bot.change.result",
        data: {
            success: false,
            action: request.action,
            code: result.code,
            message: result.message,
        },
    });
}

function parseRequest(data: unknown): Record<string, unknown> {
    if (typeof data === "string") {
        try {
            data = JSON.parse(data);
        } catch (error) {
            throw new ValidationError("账号生命周期请求 data 必须是有效 JSON", {
                cause: error instanceof Error ? error : undefined,
            });
        }
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new ValidationError("请求体必须是对象");
    }
    return data as Record<string, unknown>;
}

function requiredString(field: string, value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0) {
        throw new ValidationError(`请求字段 ${field} 必须是非空字符串`);
    }
    return value;
}

function classifyLifecycleError(
    error: unknown,
): Exclude<ManagementAccountLifecycleResult, { success: true }> {
    const message = lifecycleErrorMessage(error);
    if (error instanceof ValidationError) {
        return { success: false, status: 400, code: "ACCOUNT_REQUEST_INVALID", message };
    }
    if (error instanceof AccountLifecycleTargetNotFoundError) {
        return { success: false, status: 404, code: "ACCOUNT_TARGET_NOT_FOUND", message };
    }
    if (error instanceof AccountLifecycleConflictError) {
        return { success: false, status: 409, code: "ACCOUNT_LIFECYCLE_CONFLICT", message };
    }
    if (error instanceof UnsupportedCapabilityError) {
        return {
            success: false,
            status: 501,
            code: "ACCOUNT_LIFECYCLE_UNSUPPORTED",
            message,
        };
    }
    return { success: false, status: 500, code: "ACCOUNT_LIFECYCLE_FAILED", message };
}

function lifecycleErrorMessage(error: unknown): string {
    if (!(error instanceof Error) || !error.message.trim()) return "账号生命周期操作失败";
    return error.message.trim().replace(/\s+/gu, " ").slice(0, 500);
}

async function runAccountLifecycleOperation(
    host: ManagementAccountLifecycleHost,
    platform: string,
    uin: string,
    action: ManagementAccountLifecycleAction,
    operation: () => Promise<void>,
): Promise<void> {
    let operations = activeOperations.get(host);
    if (!operations) {
        operations = new Map();
        activeOperations.set(host, operations);
    }
    const key = `${platform}\0${uin}`;
    const activeAction = operations.get(key);
    if (activeAction) {
        throw new AccountLifecycleConflictError(
            `账号 ${platform}.${uin} 正在执行${actionLabel(activeAction)}操作，请稍后重试`,
        );
    }
    operations.set(key, action);
    try {
        await operation();
    } finally {
        operations.delete(key);
        if (operations.size === 0) activeOperations.delete(host);
    }
}

function actionLabel(action: ManagementAccountLifecycleAction): string {
    return action === "bot.start" ? "上线" : "下线";
}

function withEcho<T extends ManagementAccountLifecycleSocketResponse>(
    echo: unknown,
    response: T,
): T {
    return echo === undefined ? response : ({ ...response, echo } as T);
}

class AccountLifecycleTargetNotFoundError extends Error {}
class AccountLifecycleConflictError extends Error {}
