import { describe, expect, it, vi } from "vitest";
import { probeDoctorManagementSurface } from "./doctor-management-surface.js";

describe("doctor management surface", () => {
    it("在 API 前缀之外验证 Web origin，并保持页面证据排在管理 API 前", async () => {
        const config = { path: "/gateway", access_token: "secret" };
        const expectedIdentity = {
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
        };
        const expectedPaths = {
            configPath: "/srv/onebots/config.yaml",
            dataDirectory: "/srv/onebots/data",
        };
        const probePage = vi.fn(async () => ({
            name: "management-page",
            level: "ok" as const,
            message: "页面可用",
        }));
        const probeManagement = vi.fn(async () => [
            {
                name: "management-http-anonymous",
                level: "ok" as const,
                message: "匿名访问已拒绝",
            },
        ]);

        await expect(
            probeDoctorManagementSurface(
                {
                    baseUrl: "http://127.0.0.1:6727/gateway",
                    webUrl: "http://127.0.0.1:6727",
                    config,
                    expectedIdentity,
                    expectedPaths,
                },
                { probePage, probeManagement },
            ),
        ).resolves.toEqual([
            expect.objectContaining({ name: "management-page", level: "ok" }),
            expect.objectContaining({ name: "management-http-anonymous", level: "ok" }),
        ]);
        expect(probePage).toHaveBeenCalledWith("http://127.0.0.1:6727", "/gateway");
        expect(probeManagement).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/gateway",
            config,
            expectedIdentity,
            expectedPaths,
        );
    });

    it("保留管理页失败证据，同时继续收集管理 API 诊断", async () => {
        const checks = await probeDoctorManagementSurface(
            { baseUrl: "http://127.0.0.1:6727", webUrl: "http://127.0.0.1:6727", config: {} },
            {
                probePage: async () => ({
                    name: "management-page",
                    level: "error",
                    message: "HTML 前缀不匹配",
                }),
                probeManagement: async () => [
                    { name: "management-runtime", level: "ok", message: "运行态可用" },
                ],
            },
        );

        expect(checks).toEqual([
            expect.objectContaining({ name: "management-page", level: "error" }),
            expect.objectContaining({ name: "management-runtime", level: "ok" }),
        ]);
    });
});
