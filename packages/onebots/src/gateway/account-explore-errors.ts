/** 管理端可展示的查询失败原因；不得携带平台异常原文或请求凭据。 */
export const ACCOUNT_EXPLORE_ERRORS = {
    gateway_unavailable: { status: 503, message: "运行网关不可用，请检查网关状态" },
    gateway_unsupported: {
        status: 503,
        message: "当前运行版本不支持账号查询，请升级并激活运行版本",
    },
    context_changed: { status: 409, message: "网关实例已变化，请刷新账号页面" },
    account_unavailable: { status: 409, message: "账号当前未上线，请检查账号状态" },
    query_busy: { status: 429, message: "账号查询繁忙，请等待已有查询结束" },
    platform_query_failed: {
        status: 502,
        message: "平台读取账号资料失败，请查看网关日志中的账号查询记录",
    },
    invalid_response: { status: 502, message: "平台返回的账号资料无效，请查看网关日志" },
    query_timeout: { status: 504, message: "账号查询超时，请查看网关日志" },
    query_failed: { status: 503, message: "账号查询失败，请查看网关日志" },
} as const;

export type AccountExploreErrorCode = keyof typeof ACCOUNT_EXPLORE_ERRORS;

export function isAccountExploreErrorCode(value: unknown): value is AccountExploreErrorCode {
    return typeof value === "string" && Object.hasOwn(ACCOUNT_EXPLORE_ERRORS, value);
}

export class AccountExploreError extends Error {
    constructor(readonly code: AccountExploreErrorCode) {
        super(ACCOUNT_EXPLORE_ERRORS[code].message);
        this.name = "AccountExploreError";
    }
}
