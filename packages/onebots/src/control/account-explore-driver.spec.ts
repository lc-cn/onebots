import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { NodeGatewayDriver } from "./gateway-driver.js";

describe("账号查询真实子进程链路", () => {
    it("ICQQ 群和好友缓存经过真实适配器与 IPC 返回，失败原因不会消失", async () => {
        const workspace = await mkdtemp(join(tmpdir(), "onebots-explore-icqq-"));
        const configPath = join(workspace, "config.yaml");
        const entrypoint = join(workspace, "fixture.mjs");
        const configVersion = "a".repeat(64);
        await mkdir(join(workspace, "node_modules", "@onebots"), { recursive: true });
        await symlink(
            resolve("adapters/adapter-icqq"),
            join(workspace, "node_modules", "@onebots", "adapter-icqq"),
        );
        await writeFile(configPath, "general: {}\nicqq.123456: {}\n");
        // 只替换原生客户端来源：不登录 QQ，保留 Bot、Adapter、网关和父进程真实查询实现。
        await writeFile(
            entrypoint,
            `
import { EventEmitter } from "node:events";
import { ICQQBot } from ${JSON.stringify(pathToFileURL(resolve("adapters/adapter-icqq/lib/bot.js")).href)};
ICQQBot.prototype.start = async function () {
    this.client = Object.assign(new EventEmitter(), {
        gl: new Map([[20001, { group_id: 20001, group_name: "测试群", member_count: 2 }]]),
        fl: new Map([[10001, { user_id: 10001, nickname: "测试好友", class_id: 0 }]]),
        classes: new Map(),
        logout: async () => {},
    });
    this.emit("ready", { user_id: 123456, nickname: "测试账号" });
};
await import(${JSON.stringify(pathToFileURL(resolve("packages/onebots/lib/gateway/entry.js")).href)});
`,
        );
        const driver = new NodeGatewayDriver({
            controlInstanceId: randomUUID(),
            onExit: () => {},
            prepare: async () => ({
                configPath,
                workspacePath: workspace,
                entrypoint,
                runtimeRoot: workspace,
                configVersion,
                dependencyVersion: "fixture",
                selection: { adapters: ["icqq"], protocols: [], applications: [] },
            }),
        });
        const instance = await driver.start();
        const expected = { gatewayInstanceId: instance.id, configVersion };
        try {
            await vi.waitFor(() =>
                expect(driver.accountStatuses(instance.id).items).toContainEqual(
                    expect.objectContaining({
                        platform: "icqq",
                        accountId: "123456",
                        status: "online",
                    }),
                ),
            );
            await expect(
                driver.exploreAccount(instance.id, {
                    expected,
                    account: "icqq/123456",
                    action: "groups",
                    kind: "group",
                }),
            ).resolves.toMatchObject({
                supported: true,
                items: [{ id: "20001", name: "测试群", memberCount: 2 }],
            });
            await expect(
                driver.exploreAccount(instance.id, {
                    expected,
                    account: "icqq/123456",
                    action: "friends",
                    kind: "friend",
                }),
            ).resolves.toMatchObject({
                supported: true,
                items: [{ id: "10001", name: "测试好友" }],
            });
            await expect(
                driver.exploreAccount(instance.id, {
                    expected,
                    account: "icqq/missing",
                    action: "groups",
                    kind: "group",
                }),
            ).rejects.toMatchObject({ code: "account_unavailable" });
            await expect(
                driver.exploreAccount(instance.id, {
                    expected,
                    account: "icqq/123456",
                    action: "detail",
                    kind: "group",
                    id: "99999",
                }),
            ).rejects.toMatchObject({ code: "platform_query_failed" });
            expect(await readFile(join(workspace, ".control", "gateway.log"), "utf8")).toContain(
                "账号资料查询失败",
            );
        } finally {
            await driver.stop(instance);
            await rm(workspace, { recursive: true, force: true });
        }
    });
});
