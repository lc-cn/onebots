import { ControlRequestError } from "@onebots/core/control";

/** 服务端已投影的操作提示可直接展示；网络或第三方异常保留本地兜底文案。 */
export function accountControlErrorMessage(error: unknown, fallback: string): string {
    return error instanceof ControlRequestError &&
        typeof error.message === "string" &&
        error.message.trim()
        ? error.message
        : fallback;
}
