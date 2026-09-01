import { normalizeGatewayPathPrefix } from "@onebots/core";
import { readBoundedResponseBody, ResponseBodyTooLargeError } from "./bounded-response.js";
import type { DoctorCheck } from "./doctor-endpoint.js";
import { MANAGEMENT_HTTP_PREFIX_META, MANAGEMENT_REFERRER_POLICY } from "./management-index.js";

export const DOCTOR_MANAGEMENT_PAGE_BODY_LIMIT_BYTES = 64 * 1024;

/** 验证 Web origin 实际提供了与当前 Router 前缀匹配的 OneBots 管理页。 */
export async function probeDoctorManagementPage(
    webUrl: string,
    configuredPath: unknown,
    fetcher: typeof fetch = fetch,
): Promise<DoctorCheck> {
    const expectedPrefix = normalizeGatewayPathPrefix(configuredPath);
    try {
        const response = await fetcher(new URL("/", webUrl).toString(), {
            headers: { accept: "text/html" },
            cache: "no-store",
            redirect: "error",
            signal: AbortSignal.timeout(2_000),
        });
        if (!response.ok) {
            return failedPageCheck(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
        if (!contentType.includes("text/html")) {
            return failedPageCheck(
                `Content-Type 不是 text/html（实际为 ${contentType || "缺失"}）`,
            );
        }
        if (response.headers.get("referrer-policy")?.toLowerCase() !== MANAGEMENT_REFERRER_POLICY) {
            return failedPageCheck("Referrer-Policy 不是 no-referrer");
        }
        const cacheControl = response.headers.get("cache-control")?.toLowerCase() ?? "";
        if (!cacheControl.split(",").some(value => value.trim() === "no-store")) {
            return failedPageCheck("Cache-Control 缺少 no-store");
        }

        const body = await readBoundedResponseBody(
            response,
            DOCTOR_MANAGEMENT_PAGE_BODY_LIMIT_BYTES,
        );
        if (!hasExpectedPrefixMeta(body, expectedPrefix)) {
            return failedPageCheck(`HTML 未声明当前 Router 前缀 ${expectedPrefix || "（空）"}`);
        }
        return {
            name: "management-page",
            level: "ok",
            message: `Web 管理页可访问，Router 前缀为 ${expectedPrefix || "（空）"}`,
        };
    } catch (error) {
        const detail =
            error instanceof ResponseBodyTooLargeError
                ? error.message
                : error instanceof Error
                  ? error.message
                  : String(error);
        return failedPageCheck(detail);
    }
}

function hasExpectedPrefixMeta(body: string, expectedPrefix: string): boolean {
    const escapedPrefix = escapeRegularExpression(expectedPrefix);
    return new RegExp(
        `<meta\\s+name=["']${MANAGEMENT_HTTP_PREFIX_META}["']\\s+content=["']${escapedPrefix}["']\\s*\\/?>`,
        "iu",
    ).test(body);
}

function escapeRegularExpression(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function failedPageCheck(detail: string): DoctorCheck {
    return {
        name: "management-page",
        level: "error",
        message: `Web 管理页不可验证: ${detail}`,
    };
}
