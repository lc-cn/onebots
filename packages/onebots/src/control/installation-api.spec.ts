import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { GenerationStore } from "../installation/generation-store.js";
import { ControlInstallationService } from "./installation-service.js";
import { handleInstallationRequest, isInstallationPath } from "./installation-api.js";

const folders: string[] = [];
const services: ControlInstallationService[] = [];
afterEach(async () => {
    for (const service of services.splice(0)) await service.close();
    for (const folder of folders.splice(0)) fs.rmSync(folder, { recursive: true, force: true });
});

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-install-api-"));
    folders.push(directory);
    fs.writeFileSync(path.join(directory, "host.tgz"), "synthetic bytes");
    let active: string | null = null;
    let installed = {
        adapters: [] as string[],
        protocols: [] as string[],
        applications: [] as string[],
    };
    let document: Record<string, unknown> = {
        plugins: { adapters: [], protocols: [], applications: [] },
    };
    const service = new ControlInstallationService({
        currentGenerationId: () => active,
        currentSelection: () => structuredClone(installed),
        currentConfigurationRevision: () => "a".repeat(64),
        currentConfiguration: () => ({
            revision: "a".repeat(64),
            document: structuredClone(document),
        }),
        resolveRelease: async () => ({
            host: { name: "onebots", version: "1.2.13", spec: "1.2.13" },
            core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
            extensionVersions: {},
            archiveSha256: "b".repeat(64),
        }),
        directory,
        store: new GenerationStore({
            root: path.join(directory, "generations"),
            isActive: () => false,
        }),
        resolver: {
            host: {
                name: "onebots",
                version: "1.2.12",
                spec: `file:${directory}/host.tgz`,
                sha256: createHash("sha256").update("synthetic bytes").digest("hex"),
            },
            core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        },
        lifecycle: {
            activate: async () => {
                throw new Error("synthetic-secret activation error");
            },
        },
    });
    services.push(service);
    const request = (
        pathname: string,
        method = "POST",
        body: Record<string, unknown> = {},
        allowCredentials = false,
    ) =>
        handleInstallationRequest({
            pathname,
            method,
            body: async () => body,
            allowCredentials,
            service,
        });
    return {
        directory,
        service,
        request,
        setActive: (id: string | null) => {
            active = id;
        },
        setInstalled: (value: typeof installed) => {
            installed = structuredClone(value);
        },
        setDocument: (value: Record<string, unknown>) => {
            document = structuredClone(value);
        },
    };
}

const selection = { adapters: [], protocols: [], applications: ["zhin"] };

describe("installation HTTP boundary", () => {
    it("缺少CAS前提拒绝，陈旧计划和安装返回固定409", async () => {
        const test = fixture();
        expect(
            (await test.request("/api/control/installations/plan", "POST", { selection })).status,
        ).toBe(400);
        const plan = await test.service.plan(selection, null);
        test.setActive("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
        expect(
            await test.request("/api/control/installations/plan", "POST", {
                selection,
                expectedGenerationId: null,
            }),
        ).toEqual({ status: 409, body: { message: "运行版本已变化，请刷新并重新确认安装计划" } });
        expect(
            (
                await test.request("/api/control/installations", "POST", {
                    id: "stale",
                    planId: plan.id,
                })
            ).status,
        ).toBe(409);
    });
    it("目录与计划无需账号，框架选择保留且不启动任何协议", async () => {
        const test = fixture();
        expect(await test.request("/api/control/installations/catalog", "GET")).toMatchObject({
            status: 200,
            body: {
                adapters: expect.any(Array),
                protocols: expect.any(Array),
                applications: expect.any(Array),
            },
        });
        const result = await test.request("/api/control/installations/plan", "POST", {
            selection,
            expectedGenerationId: null,
        });
        expect(result).toMatchObject({
            status: 200,
            body: { selection, recommendations: expect.any(Array) },
        });
        expect(fs.existsSync(path.join(test.directory, "config.yaml"))).toBe(false);
    });

    it("完整集合计划识别移除，并以409返回引用冲突", async () => {
        const test = fixture();
        test.setInstalled({ adapters: ["mock"], protocols: [], applications: ["zhin"] });
        test.setDocument({
            plugins: { adapters: ["mock"], protocols: [], applications: [] },
            "mock.account": {},
        });
        const conflict = await test.request("/api/control/installations/plan", "POST", {
            selection: { adapters: [], protocols: [], applications: ["zhin"] },
            expectedGenerationId: null,
        });
        expect(conflict).toMatchObject({
            status: 409,
            body: {
                message: expect.stringContaining("当前配置引用"),
                conflicts: [{ type: "adapter", name: "mock" }],
            },
        });
        test.setDocument({
            plugins: { adapters: [], protocols: [], applications: [] },
        });
        const planned = await test.request("/api/control/installations/plan", "POST", {
            selection: { adapters: [], protocols: [], applications: ["zhin"] },
            expectedGenerationId: null,
        });
        expect(planned).toMatchObject({
            status: 200,
            body: {
                selection: { adapters: [], protocols: [], applications: ["zhin"] },
                removed: { adapters: ["mock"], protocols: [], applications: [] },
            },
        });
    });

    it("拒绝用户注入host/artifact/URL/执行器，不将它们转给安装器", async () => {
        const test = fixture();
        for (const field of [
            "host",
            "core",
            "artifacts",
            "fetchMetadata",
            "pnpmExecutable",
            "registry",
            "source",
        ]) {
            expect(
                (
                    await test.request("/api/control/installations/plan", "POST", {
                        selection,
                        [field]: "synthetic-secret",
                    })
                ).status,
            ).toBe(400);
            expect(
                (
                    await test.request("/api/control/installations", "POST", {
                        id: "op",
                        planId: "a".repeat(64),
                        [field]: "synthetic-secret",
                    })
                ).status,
            ).toBe(400);
        }
        expect(
            (
                await test.request("/api/control/installations/plan", "POST", {
                    selection: { ...selection, host: "evil" },
                })
            ).status,
        ).toBe(400);
        expect(fs.readdirSync(path.join(test.directory, "installations"))).toEqual([]);
    });

    it("私有token仅经受保护传输接受，持久操作响应不含授权", async () => {
        const test = fixture();
        const plan = await test.service.plan(selection, null);
        fs.rmSync(path.join(test.directory, "artifacts"), { recursive: true });
        const body = { id: "operation", planId: plan.id, token: "synthetic-secret" };
        expect((await test.request("/api/control/installations", "POST", body)).status).toBe(403);
        const accepted = await test.request("/api/control/installations", "POST", body, true);
        expect(accepted).toMatchObject({ status: 202, body: { id: "operation", phase: "queued" } });
        expect(JSON.stringify(accepted)).not.toContain("synthetic-secret");
        await test.service.close();
        expect(await test.request("/api/control/installations/operation", "GET")).toMatchObject({
            status: 200,
            body: { phase: "failed", error: "ARTIFACT_INPUT_FAILED" },
        });
    });

    it("坏请求/第三方异常/未知状态均返回固定错误，不暴露正文或路径", async () => {
        const test = fixture();
        const parseFailure = await handleInstallationRequest({
            pathname: "/api/control/installations/plan",
            method: "POST",
            body: async () => {
                throw new Error("synthetic-secret");
            },
            service: test.service,
            allowCredentials: false,
        });
        expect(parseFailure).toEqual({ status: 400, body: { message: "安装请求无效" } });
        expect(
            await test.request(
                "/api/control/generations/00000000-0000-0000-0000-000000000000/activate",
            ),
        ).toEqual({ status: 500, body: { message: "安装控制操作失败，请检查本地状态" } });
        expect(await test.request("/api/control/installations/missing", "GET")).toEqual({
            status: 500,
            body: { message: "安装控制操作失败，请检查本地状态" },
        });
        expect(
            (
                await test.request("/api/control/installations/plan", "POST", {
                    selection: { ...selection, adapters: [null] },
                })
            ).status,
        ).toBe(400);
        expect((await test.request("/api/control/installations/plan", "DELETE")).status).toBe(404);
        expect(isInstallationPath("/api/control/installations/catalog")).toBe(true);
        expect(isInstallationPath("/api/control/installations-evil")).toBe(false);
    });
});

describe("升级计划HTTP边界", () => {
    it("客户端只能提供双基线，不能指定目标包、版本或下载凭据", async () => {
        const f = fixture();
        const expected = { generationId: null, configRevision: "a".repeat(64) };
        expect(isInstallationPath("/api/control/updates/plan")).toBe(true);
        for (const body of [
            {},
            { expected: {} },
            { expected: { ...expected, url: "private" } },
            { expected, token: "private" },
            { expected, version: "9.9.9" },
        ]) {
            expect((await f.request("/api/control/updates/plan", "POST", body)).status).toBe(400);
        }
        expect((await f.request("/api/control/updates/plan", "POST", { expected })).status).toBe(
            200,
        );
        expect(
            (
                await f.request("/api/control/updates/plan", "POST", {
                    expected: { ...expected, configRevision: "c".repeat(64) },
                })
            ).status,
        ).toBe(409);
    });
});
