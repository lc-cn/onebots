import { describe, expect, it, vi } from "vitest";
import {
    applyManagementDocumentSecurityHeaders,
    MANAGEMENT_HTTP_PREFIX_META,
    MANAGEMENT_REFERRER_POLICY,
    isManagementSpaPath,
    renderManagementIndexHtml,
} from "./management-index.js";

describe("management index runtime configuration", () => {
    it("注入规范化的 HTTP 前缀而不改变模块入口", () => {
        const source =
            '<html><head><title>OneBots</title></head><body><script src="/assets/app.js"></script></body></html>';

        const rendered = renderManagementIndexHtml(source, " gateway/ ");

        expect(rendered).toContain(
            `<meta name="${MANAGEMENT_HTTP_PREFIX_META}" content="/gateway">`,
        );
        expect(rendered).toContain(
            `<meta name="referrer" content="${MANAGEMENT_REFERRER_POLICY}">`,
        );
        expect(rendered).toContain('<script src="/assets/app.js"></script>');
        expect(rendered.indexOf('name="referrer"')).toBeLessThan(rendered.indexOf("<title>"));
        expect(rendered.indexOf(MANAGEMENT_HTTP_PREFIX_META)).toBeLessThan(
            rendered.indexOf("</head>"),
        );
    });

    it("根部署注入空前缀，并拒绝危险前缀或损坏的 Web 产物", () => {
        expect(renderManagementIndexHtml("<head></head>", "/")).toContain('content=""');
        expect(() => renderManagementIndexHtml("<head></head>", "//evil.example")).toThrow(
            "网关 path 不能以 // 开头",
        );
        expect(() => renderManagementIndexHtml("<html></html>", "/gateway")).toThrow(
            "缺少有效的 <head>...</head>",
        );
    });

    it("通过 HTTP 响应头禁止管理入口发送 Referer", () => {
        const set = vi.fn();

        applyManagementDocumentSecurityHeaders({ set });

        expect(set).toHaveBeenCalledWith("Referrer-Policy", "no-referrer");
    });

    it("保留 Web 产物已有的 no-referrer meta 而不重复注入", () => {
        const rendered = renderManagementIndexHtml(
            '<html><head><meta name="referrer" content="no-referrer"><title>OneBots</title></head></html>',
            "",
        );

        expect(rendered.match(/name="referrer"/g)).toHaveLength(1);
    });

    it.each(["/", "/index.html", "/login", "/system", "/message-debug", "/bots/primary"])(
        "将管理端页面刷新路径 %s 交给动态 HTML",
        path => {
            expect(isManagementSpaPath(path)).toBe(true);
        },
    );

    it.each(["/assets/app.js", "/api/system", "/health", "/unknown"])(
        "不拦截静态、API 或未知路径 %s",
        path => {
            expect(isManagementSpaPath(path)).toBe(false);
        },
    );
});
