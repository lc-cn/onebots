import { normalizeGatewayPathPrefix } from "@onebots/core";

export const MANAGEMENT_HTTP_PREFIX_META = "onebots-http-prefix";
const MANAGEMENT_SPA_PATH =
    /^\/(login|bots|extensions|config|system|terminal|logs|message-debug)(\/.*)?$/;

export function isManagementSpaPath(path: string): boolean {
    return path === "/" || path === "/index.html" || MANAGEMENT_SPA_PATH.test(path);
}

/** 向随包发布的管理端 HTML 注入当前进程的非敏感 HTTP 路径前缀。 */
export function renderManagementIndexHtml(source: string, configuredPath: unknown): string {
    const prefix = normalizeGatewayPathPrefix(configuredPath);
    const closingHead = source.indexOf("</head>");
    if (closingHead < 0) throw new Error("Web 管理端 index.html 缺少 </head>");

    const meta = `<meta name="${MANAGEMENT_HTTP_PREFIX_META}" content="${escapeHtmlAttribute(prefix)}">`;
    return `${source.slice(0, closingHead)}${meta}\n${source.slice(closingHead)}`;
}

function escapeHtmlAttribute(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}
