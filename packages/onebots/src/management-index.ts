import { normalizeGatewayPathPrefix } from "@onebots/core";

export const MANAGEMENT_HTTP_PREFIX_META = "onebots-http-prefix";
export const MANAGEMENT_REFERRER_POLICY = "no-referrer";
const MANAGEMENT_SPA_PATH =
    /^\/(login|bots|extensions|config|system|terminal|logs|message-debug)(\/.*)?$/;

interface ManagementDocumentResponse {
    set(field: string, value: string): void;
}

export function isManagementSpaPath(path: string): boolean {
    return path === "/" || path === "/index.html" || MANAGEMENT_SPA_PATH.test(path);
}

/** 向随包发布的管理端 HTML 注入当前进程的非敏感 HTTP 路径前缀。 */
export function renderManagementIndexHtml(source: string, configuredPath: unknown): string {
    const prefix = normalizeGatewayPathPrefix(configuredPath);
    const openingHead = source.indexOf("<head");
    const openingHeadEnd = openingHead < 0 ? -1 : source.indexOf(">", openingHead);
    const closingHead = source.indexOf("</head>");
    if (openingHeadEnd < 0 || closingHead < openingHeadEnd) {
        throw new Error("Web 管理端 index.html 缺少有效的 <head>...</head>");
    }

    const referrerMeta = `<meta name="referrer" content="${MANAGEMENT_REFERRER_POLICY}">`;
    const hasReferrerMeta =
        /<meta\s+name=["']referrer["']\s+content=["']no-referrer["']\s*\/?>/i.test(
            source.slice(openingHeadEnd + 1, closingHead),
        );
    const prefixMeta = `<meta name="${MANAGEMENT_HTTP_PREFIX_META}" content="${escapeHtmlAttribute(prefix)}">`;
    return `${source.slice(0, openingHeadEnd + 1)}${hasReferrerMeta ? "" : `\n${referrerMeta}`}${source.slice(openingHeadEnd + 1, closingHead)}${prefixMeta}\n${source.slice(closingHead)}`;
}

/** 阻止入口 URL 中的一次性鉴权参数随 Referer 泄露到后续资源请求。 */
export function applyManagementDocumentSecurityHeaders(ctx: ManagementDocumentResponse): void {
    ctx.set("Referrer-Policy", MANAGEMENT_REFERRER_POLICY);
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
