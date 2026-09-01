import { describe, expect, it, vi } from "vitest";
import {
    DOCTOR_MANAGEMENT_PAGE_BODY_LIMIT_BYTES,
    probeDoctorManagementPage,
} from "./doctor-management-page.js";
import { renderManagementIndexHtml } from "./management-index.js";

describe("doctor management page probe", () => {
    it("接受带当前 Router 前缀与安全响应头的管理页", async () => {
        const fetcher = vi.fn<typeof fetch>(async () => managementPageResponse("/gateway"));

        await expect(
            probeDoctorManagementPage("http://127.0.0.1:7788", "gateway", fetcher),
        ).resolves.toEqual({
            name: "management-page",
            level: "ok",
            message: "Web 管理页可访问，Router 前缀为 /gateway",
        });
        expect(fetcher).toHaveBeenCalledWith("http://127.0.0.1:7788/", {
            headers: { accept: "text/html" },
            cache: "no-store",
            redirect: "error",
            signal: expect.any(AbortSignal),
        });
    });

    it("拒绝通用成功页和属于另一 Router 前缀的 OneBots 页面", async () => {
        const generic = await probeDoctorManagementPage(
            "http://127.0.0.1:7788",
            "/gateway",
            vi.fn(async () => secureHtmlResponse("<html><head></head></html>")),
        );
        const drifted = await probeDoctorManagementPage(
            "http://127.0.0.1:7788",
            "/gateway",
            vi.fn(async () => managementPageResponse("/other")),
        );

        expect(generic).toMatchObject({
            name: "management-page",
            level: "error",
            message: expect.stringContaining("HTML 未声明当前 Router 前缀 /gateway"),
        });
        expect(drifted).toMatchObject({
            name: "management-page",
            level: "error",
            message: expect.stringContaining("HTML 未声明当前 Router 前缀 /gateway"),
        });
    });

    it("拒绝缺少安全响应头或正文超过诊断上限的页面", async () => {
        const missingHeaders = await probeDoctorManagementPage(
            "http://127.0.0.1:7788",
            "",
            vi.fn(
                async () =>
                    new Response(renderManagementIndexHtml("<html><head></head></html>", ""), {
                        headers: { "content-type": "text/html" },
                    }),
            ),
        );
        const oversized = await probeDoctorManagementPage(
            "http://127.0.0.1:7788",
            "",
            vi.fn(async () =>
                secureHtmlResponse("x".repeat(DOCTOR_MANAGEMENT_PAGE_BODY_LIMIT_BYTES + 1)),
            ),
        );

        expect(missingHeaders.message).toContain("Referrer-Policy 不是 no-referrer");
        expect(oversized.message).toContain("响应正文超过 64 KiB 上限");
    });
});

function managementPageResponse(prefix: string): Response {
    return secureHtmlResponse(
        renderManagementIndexHtml("<html><head></head><body></body></html>", prefix),
    );
}

function secureHtmlResponse(body: string): Response {
    return new Response(body, {
        headers: {
            "content-type": "text/html; charset=utf-8",
            "referrer-policy": "no-referrer",
            "cache-control": "no-store",
        },
    });
}
