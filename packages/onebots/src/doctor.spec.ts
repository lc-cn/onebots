import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { inspectSensitiveFilePermissions, probeDoctorEndpoint } from "./doctor.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.runIf(process.platform !== "win32")("doctor config permissions", () => {
    it("accepts owner-only access and reports intentional group read as a warning", () => {
        const privateConfig = createConfigFile(0o600);
        const groupReadableConfig = createConfigFile(0o640);

        expect(inspectSensitiveFilePermissions(privateConfig, "config-mode", "配置文件")).toEqual({
            name: "config-mode",
            level: "ok",
            message: "配置文件权限 600 未向组或其他用户开放",
        });
        expect(
            inspectSensitiveFilePermissions(groupReadableConfig, "config-mode", "配置文件", true),
        ).toEqual({
            name: "config-mode",
            level: "warning",
            message: "配置文件权限 640 允许同组用户读取；请确认这是服务部署所需",
        });
        expect(fs.statSync(groupReadableConfig).mode & 0o777).toBe(0o640);
    });

    it.each([
        { mode: 0o644, label: "644" },
        { mode: 0o620, label: "620" },
    ])("rejects unsafe mode $label without changing it", ({ mode }) => {
        const configPath = createConfigFile(mode);

        expect(
            inspectSensitiveFilePermissions(configPath, "config-mode", "配置文件"),
        ).toMatchObject({
            name: "config-mode",
            level: "error",
            message: expect.stringContaining(mode.toString(8)),
        });
        expect(fs.statSync(configPath).mode & 0o777).toBe(mode);
    });

    it("repairs unsafe config backups only when --fix is explicit", () => {
        const backupPath = createConfigFile(0o644);

        expect(
            inspectSensitiveFilePermissions(backupPath, "config-backup-mode", "配置备份", true),
        ).toEqual({
            name: "config-backup-mode",
            level: "ok",
            message: "已将配置备份权限从 644 收紧为 0600",
            fixed: true,
        });
        expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
    });
});

describe("doctor health probes", () => {
    it("fails readiness when any configured account is offline and reports the platform", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        adapters: { kook: { online: 0, offline: 1, total: 1 } },
                        summary: { total_accounts: 1, online_accounts: 0 },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 503；账号 0/1 在线；未就绪: kook(0/1)",
        });
    });

    it("accepts a healthy endpoint and keeps its status evidence", async () => {
        const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toEqual({
            name: "health",
            level: "ok",
            message: "health: HTTP 200；状态 ok",
        });
    });

    it("reports protocol startup failures even when the platform account is online", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        configured: true,
                        adapters: {
                            kook: {
                                online: 1,
                                offline: 0,
                                total: 1,
                                protocols: { ready: 0, unavailable: 1, total: 1 },
                            },
                        },
                        summary: {
                            total_accounts: 1,
                            online_accounts: 1,
                            total_protocols: 1,
                            ready_protocols: 0,
                        },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 503；账号 1/1 在线；协议 0/1 就绪；协议未就绪: kook(0/1)",
        });
    });

    it("reports online accounts that have no protocol outlet", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        configured: true,
                        adapters: {
                            mock: {
                                online: 1,
                                offline: 0,
                                total: 1,
                                accounts_without_protocols: 1,
                                protocols: { ready: 0, unavailable: 0, total: 0 },
                            },
                        },
                        summary: {
                            total_accounts: 1,
                            online_accounts: 1,
                            total_protocols: 0,
                            ready_protocols: 0,
                            accounts_without_protocols: 1,
                        },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 503；账号 1/1 在线；无协议出口: mock(1)",
        });
    });

    it("marks a reachable but unconfigured first-run gateway as a warning", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: true,
                        configured: false,
                        adapters: {},
                        summary: { total_accounts: 0, online_accounts: 0 },
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "warning",
            message: "ready: HTTP 200；未配置账号；账号 0/0 在线",
        });
    });

    it("rejects a contradictory HTTP 200 readiness body", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(JSON.stringify({ ready: false, configured: true }), { status: 200 }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 200；响应未声明 ready: true",
        });
    });

    it("rejects a non-JSON health response even when it returns HTTP 200", async () => {
        const fetcher = vi.fn(async () => new Response("OK", { status: 200 }));

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toEqual({
            name: "health",
            level: "error",
            message: "health: HTTP 200；响应 OK；响应不是有效 JSON",
        });
    });
});

function createConfigFile(mode: number): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-mode-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, "general: {}\n", { mode });
    fs.chmodSync(configPath, mode);
    return configPath;
}
