import { ValidationError } from "@onebots/core";

export const MANAGEMENT_EXPECTED_INSTANCE_HEADER = "X-OneBots-Expected-Instance-Id";

interface ManagementInstanceSource {
    info: { instance_id?: unknown };
}

interface ManagementInstanceRequestContext {
    get?(name: string): string;
}

/** 让管理写操作只作用于生成当前页面快照的 OneBots 实例。 */
export function assertManagementInstancePrecondition(
    source: ManagementInstanceSource,
    context: ManagementInstanceRequestContext,
    operation: string,
): void {
    const rawExpected = context.get?.(MANAGEMENT_EXPECTED_INSTANCE_HEADER) ?? "";
    if (!rawExpected) return;
    const expected = rawExpected.trim();
    if (!expected) {
        throw new ValidationError(`${operation}请求的实例前置条件必须是非空字符串`);
    }
    const current = source.info.instance_id;
    if (typeof current !== "string" || !current.trim()) {
        throw new ManagementInstanceMismatchError(
            `当前 OneBots 实例无法证明${operation}身份，请刷新页面后重试`,
        );
    }
    if (expected !== current.trim()) {
        throw new ManagementInstanceMismatchError(
            `${operation}请求期望实例 ${expected}，当前已由实例 ${current.trim()} 接管`,
        );
    }
}

export class ManagementInstanceMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "ManagementInstanceMismatchError";
    }
}
