import { DingTalkError } from "./errors.js";

const URL_SEMANTICS = /[?#\\\u0000-\u001f]/u;

/**
 * 校验钉钉 OpenAPI 相对路径。查询参数必须走独立 query，避免 URL 解析改变目标主机或路径。
 */
export function requireDingTalkApiPath(value: unknown): string {
    if (
        typeof value !== "string" ||
        !value.startsWith("/") ||
        value.startsWith("//") ||
        value.includes("..") ||
        URL_SEMANTICS.test(value)
    ) {
        throw DingTalkError.invalid(
            "钉钉 API path 必须为不含 URL 语义的安全绝对路径",
            "DINGTALK_API_PATH_INVALID",
            { path: value },
        );
    }
    return value;
}
