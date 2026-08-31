import { ErrorCategory, OneBotsError, UnsupportedCapabilityError, ValidationError } from "onebots";
import type { Milky } from "./types.js";

export class MilkyActionNotFoundError extends Error {
    readonly httpStatus = 404;
    readonly retcode = -404;

    constructor(readonly action: string) {
        super(`Milky API ${action} 不存在`);
        this.name = "MilkyActionNotFoundError";
    }
}

/** 将输入、能力与运行时错误收敛为稳定的 Milky 失败响应。 */
export function toMilkyFailure(error: unknown): Milky.Response {
    if (error instanceof MilkyActionNotFoundError) {
        return failed(error.retcode, error.message);
    }
    if (error instanceof TypeError || error instanceof ValidationError) {
        return failed(-400, error.message);
    }
    if (error instanceof UnsupportedCapabilityError) {
        return failed(-404, error.message);
    }
    if (error instanceof OneBotsError) {
        if (error.category === ErrorCategory.VALIDATION) return failed(-400, error.message);
        if (error.category === ErrorCategory.RESOURCE) return failed(-404, error.message);
    }
    return failed(-500, error instanceof Error ? error.message : "未知错误");
}

function failed(retcode: number, message: string): Milky.Response {
    return { status: "failed", retcode, message };
}
