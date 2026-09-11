import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BaseApp } from "@onebots/core";
import { MockAdapter } from "../../../../adapters/adapter-mock/src/adapter.js";
import { projectMockMessage } from "../../../../adapters/adapter-mock/src/events.js";
import "../../../../protocols/onebot-v11/protocol/src/index.js";
import { GatewayApp } from "./app.js";

const originalConfigDir = BaseApp.configDir;
const originalConfigFileName = BaseApp.configFileName;
let app: GatewayApp | undefined;
let workspace: string | undefined;

afterEach(async () => {
    try {
        await app?.stop();
    } finally {
        app = undefined;
        BaseApp.configDir = originalConfigDir;
        BaseApp.configFileName = originalConfigFileName;
        if (workspace) rmSync(workspace, { recursive: true, force: true });
        workspace = undefined;
    }
});

async function startGateway() {
    workspace = mkdtempSync(path.join(tmpdir(), "onebots-debug-app-"));
    BaseApp.configDir = workspace;
    BaseApp.configFileName = "snapshot.yaml";
    mkdirSync(path.join(workspace, "data"));
    app = new GatewayApp({
        log_level: "off",
        general: {},
        "mock.bot": {
            auto_events: false,
            latency: 0,
            "onebot.v11": { use_http: true, use_ws: false, heartbeat_interval: 0 },
        },
    });
    await app.start();
    const adapter = app.adapters.get("mock");
    if (!(adapter instanceof MockAdapter)) throw new Error("真实 Mock 适配器未加载");
    const account = adapter.accounts.get("bot");
    if (!account) throw new Error("真实 Mock 账号未加载");
    const protocol = account.protocols.find(
        item => item.name === "onebot" && item.version === "v11",
    );
    if (!protocol) throw new Error("真实 OneBot v11 协议未加载");
    app.messageDebug.clear();
    return { gateway: app, adapter, account, protocol };
}

describe("真实网关消息调试旁路", () => {
    it("Mock 消息经真实 OneBot 转换，分别记录入站与出站且继续分发", async () => {
        const { gateway, account, protocol } = await startGateway();
        const delivered = vi.fn();
        protocol.on("dispatch", delivered);
        await account.client.triggerEvent("message", {
            type: "private",
            message_id: "message-1",
            user_id: "42",
            nickname: "tester",
            content: "hello debug",
            time: 1700000000,
        });
        expect(delivered).toHaveBeenCalledOnce();
        expect(JSON.parse(delivered.mock.calls[0][0])).toMatchObject({
            post_type: "message",
            message_type: "private",
            raw_message: "hello debug",
        });
        const history = gateway.messageDebug.getHistory();
        expect(history).toHaveLength(2);
        expect(history[0]).toMatchObject({
            direction: "inbound",
            platform: "mock",
            account_id: "bot",
            payload: { type: "message", raw_message: "hello debug" },
        });
        expect(history[1]).toMatchObject({
            direction: "outbound",
            platform: "mock",
            account_id: "bot",
            protocol: "onebot",
            version: "v11",
            payload: delivered.mock.calls[0][0],
        });
    });

    it("原始事件含不可序列化数据时，安全占位不阻断实际协议监听器", async () => {
        const { gateway, adapter, account, protocol } = await startGateway();
        const delivered = vi.fn();
        protocol.on("dispatch", delivered);
        const circular: { self?: unknown } = {};
        circular.self = circular;
        const invalid = [
            1n,
            circular,
            {
                get secret() {
                    throw new Error("PRIVATE");
                },
            },
        ];
        for (const raw of invalid) {
            const event = projectMockMessage(
                {
                    type: "private",
                    message_id: "message-2",
                    user_id: "42",
                    content: "still delivered",
                    time: 1700000000,
                },
                { botId: "bot", createId: value => adapter.createId(value) },
            );
            // 不改动协议需要的通用字段，只使调试保留的原始事件不能序列化。
            const withBadRaw = { ...event, raw_event: raw };
            await expect(account.dispatchAwaited(withBadRaw)).resolves.toBeUndefined();
        }
        expect(delivered).toHaveBeenCalledTimes(3);
        const history = gateway.messageDebug.getHistory();
        expect(history).toHaveLength(6);
        expect(
            history.filter(item => item.direction === "inbound").map(item => item.payload),
        ).toEqual(invalid.map(() => ({ debugUnavailable: true, reason: "消息无法序列化为 JSON" })));
        expect(
            history.filter(item => item.direction === "outbound").map(item => item.payload),
        ).toEqual(delivered.mock.calls.map(call => call[0]));
        expect(JSON.stringify(history)).not.toContain("PRIVATE");
    });
});
