import { describe, expect, it } from "vitest";
import {
    MANAGEMENT_HTTP_PREFIX_META,
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
        expect(rendered).toContain('<script src="/assets/app.js"></script>');
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
            "缺少 </head>",
        );
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
