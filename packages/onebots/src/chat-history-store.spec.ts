import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
    ChatHistoryStore,
    projectInboundChatMessage,
    projectOutboundChatMessage,
} from "./chat-history-store.js";

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});

function store() {
    const directory = mkdtempSync(join(tmpdir(), "onebots-chat-history-"));
    directories.push(directory);
    return new ChatHistoryStore(join(directory, "chat.db"));
}

const chatId = (string: string) => ({ string, source: string, number: 1 });

describe("控制页聊天历史", () => {
    it("缺失或非正平台时间仍以接收时间保存并展示消息", () => {
        const history = store();
        for (const timestamp of [undefined, 0, -1]) {
            const projected = projectInboundChatMessage("mock", "bot", {
                type: "message",
                message_type: "private",
                timestamp,
                message_id: chatId(`message-${timestamp}`),
                sender: { id: chatId("friend"), name: "好友" },
                message: [{ type: "text", data: { text: "有效消息" } }],
            });
            expect(projected?.time).toBeGreaterThan(0);
            history.append(projected!);
        }
        expect(
            history.history({
                platform: "mock",
                accountId: "bot",
                sceneType: "private",
                sceneId: "friend",
            }),
        ).toHaveLength(3);
        history.close();
    });

    it("只保存规范化文本和必要索引，不落盘 raw_event", () => {
        const history = store();
        const message = projectInboundChatMessage("mock", "bot", {
            type: "message",
            message_type: "group",
            timestamp: Date.now(),
            message_id: chatId("message-1"),
            sender: { id: chatId("friend"), name: "好友" },
            group: { id: chatId("group") },
            message: [
                { type: "text", data: { text: "你好" } },
                { type: "image", data: { url: "secret" } },
            ],
            raw_event: { token: "must-not-persist" },
        });
        expect(message?.text).toBe("你好[图片]");
        history.append(message!);
        history.append(message!);
        const saved = history.history({
            platform: "mock",
            accountId: "bot",
            sceneType: "group",
            sceneId: "group",
        });
        expect(saved).toHaveLength(1);
        expect(JSON.stringify(saved)).not.toContain("must-not-persist");
        expect(JSON.stringify(saved)).not.toContain("secret");
        history.close();
    });

    it("记录发出消息并按设置关闭和清理", () => {
        const history = store();
        const message = projectOutboundChatMessage(
            "mock",
            "bot",
            {
                scene_type: "private",
                scene_id: chatId("friend"),
                message: [{ type: "text", data: { text: "回复" } }],
            },
            { message_id: chatId("out-1") },
        );
        history.append(message!);
        expect(
            history.history({
                platform: "mock",
                accountId: "bot",
                sceneType: "private",
                sceneId: "friend",
            }),
        ).toHaveLength(1);
        expect(history.updateSettings({ enabled: false, retentionDays: 30 })).toEqual({
            enabled: false,
            retentionDays: 30,
        });
        history.append({ ...message!, messageId: "out-2" });
        expect(
            history.history({
                platform: "mock",
                accountId: "bot",
                sceneType: "private",
                sceneId: "friend",
            }),
        ).toHaveLength(1);
        expect(history.clear()).toBe(1);
        history.close();
    });

    it("清理和过期删除使另一连接的历史修订号变化，普通新消息不重置旧页", () => {
        const directory = mkdtempSync(join(tmpdir(), "onebots-chat-revision-"));
        directories.push(directory);
        const file = join(directory, "chat.db");
        const writer = new ChatHistoryStore(file);
        const reader = new ChatHistoryStore(file);
        const query = {
            platform: "mock",
            accountId: "bot",
            sceneType: "private" as const,
            sceneId: "friend",
        };
        const initial = reader.historyPage(query).revision;
        writer.append({
            ...query,
            senderId: "friend",
            senderName: "好友",
            direction: "inbound",
            text: "新消息",
            time: Date.now(),
        });
        expect(reader.historyPage(query)).toMatchObject({
            revision: initial,
            messages: [{ text: "新消息" }],
        });
        expect(writer.clear()).toBe(1);
        const afterClear = reader.historyPage(query);
        expect(afterClear.messages).toEqual([]);
        expect(afterClear.revision).not.toBe(initial);

        writer.append({
            ...query,
            senderId: "friend",
            senderName: "好友",
            direction: "inbound",
            text: "旧消息",
            time: Date.now() - 2 * 86_400_000,
        });
        writer.updateSettings({ enabled: true, retentionDays: 1 });
        const afterPrune = reader.historyPage(query);
        expect(afterPrune.messages).toEqual([]);
        expect(afterPrune.revision).not.toBe(afterClear.revision);
        reader.close();
        writer.close();
    });

    it("多人 direct 按规范化会话 ID 归档，不混入发言人的一对一记录", () => {
        const history = store();
        const message = projectInboundChatMessage("slack", "bot", {
            type: "message",
            message_type: "direct",
            timestamp: Date.now(),
            message_id: chatId("message-1"),
            sender: { id: chatId("user-1"), name: "成员" },
            scene_id: chatId("mpim-1"),
            message: [{ type: "text", data: { text: "多人会话" } }],
        });
        expect(message).toMatchObject({ sceneType: "direct", sceneId: "mpim-1" });
        history.append(message!);
        expect(
            history.history({
                platform: "slack",
                accountId: "bot",
                sceneType: "private",
                sceneId: "user-1",
            }),
        ).toEqual([]);
        expect(
            history.history({
                platform: "slack",
                accountId: "bot",
                sceneType: "direct",
                sceneId: "mpim-1",
            }),
        ).toMatchObject([{ text: "多人会话", senderId: "user-1" }]);
        history.close();
    });

    it("最近会话按账号和完整场景隔离，返回每段会话的最新消息", () => {
        const history = store();
        const append = (
            accountId: string,
            sceneType: "direct" | "channel",
            sceneId: string,
            guildId?: string,
        ) =>
            history.append({
                platform: "mock",
                accountId,
                sceneType,
                sceneId,
                ...(guildId ? { guildId } : {}),
                senderId: "user",
                senderName: "用户",
                direction: "inbound",
                text: `${sceneId}-${guildId ?? ""}`,
                time: Date.now(),
            });
        append("bot", "direct", "room");
        append("bot", "channel", "general", "guild-a");
        append("bot", "channel", "general", "guild-b");
        append("other", "direct", "room");
        append("bot", "direct", "room");
        expect(history.conversations("mock", "bot")).toMatchObject([
            { sceneType: "direct", sceneId: "room", latest: { text: "room-" } },
            { sceneType: "channel", sceneId: "general", guildId: "guild-b" },
            { sceneType: "channel", sceneId: "general", guildId: "guild-a" },
        ]);
        expect(history.conversations("mock", "other")).toHaveLength(1);
        history.close();
    });

    it("最近会话以最新消息 ID 分页，已看过的会话不会在下一页重现", () => {
        const history = store();
        for (let index = 0; index < 52; index++)
            history.append({
                platform: "mock",
                accountId: "bot",
                sceneType: "direct",
                sceneId: `room-${index}`,
                senderId: "user",
                senderName: "用户",
                direction: "inbound",
                text: "消息",
                time: Date.now(),
            });
        const first = history.conversations("mock", "bot").slice(0, 50);
        expect(first).toHaveLength(50);
        expect(history.conversations("mock", "bot", first.at(-1)!.latest.id)).toMatchObject([
            { sceneId: "room-1" },
            { sceneId: "room-0" },
        ]);
        history.close();
    });

    it("没有独立会话 ID 的 direct 仍归入一对一历史", () => {
        const message = projectInboundChatMessage("twitch", "bot", {
            type: "message",
            message_type: "direct",
            timestamp: Date.now(),
            message_id: chatId("message-1"),
            sender: { id: chatId("viewer-1"), name: "观众" },
            message: [{ type: "text", data: { text: "你好" } }],
        });
        expect(message).toMatchObject({ sceneType: "private", sceneId: "viewer-1" });
    });

    it("发出消息采用平台确认的 direct 会话身份，不伪装成一对一", () => {
        const message = projectOutboundChatMessage(
            "matrix",
            "bot",
            {
                scene_type: "direct",
                scene_id: chatId("!room:hs"),
                message: [{ type: "text", data: { text: "回复" } }],
            },
            {
                message_id: chatId("$sent"),
                scene: { scene_type: "direct", scene_id: chatId("!room:hs") },
            },
        );
        expect(message).toMatchObject({ sceneType: "direct", sceneId: "!room:hs" });
        expect(
            projectOutboundChatMessage(
                "twitch",
                "bot",
                {
                    scene_type: "direct",
                    scene_id: chatId("viewer-1"),
                    message: [{ type: "text", data: { text: "回复" } }],
                },
                { message_id: chatId("sent") },
            ),
        ).toMatchObject({ sceneType: "private", sceneId: "viewer-1" });
    });

    it("平台自回显先到时仍按发出消息展示，且未来时间不会延长保留期", () => {
        const history = store();
        const query = {
            platform: "mock",
            accountId: "bot",
            sceneType: "private" as const,
            sceneId: "friend",
        };
        const incoming = projectInboundChatMessage("mock", "bot", {
            type: "message",
            message_type: "private",
            timestamp: Date.now() + 10 * 86_400_000,
            message_id: chatId("same"),
            sender: { id: chatId("friend"), name: "好友" },
            message: [{ type: "text", data: { text: "回显" } }],
        });
        const outgoing = projectOutboundChatMessage(
            "mock",
            "bot",
            {
                scene_type: "private",
                scene_id: chatId("friend"),
                message: [{ type: "text", data: { text: "发出" } }],
            },
            { message_id: chatId("same") },
        );
        history.append(incoming!);
        history.append(outgoing!);
        const saved = history.history(query);
        expect(saved).toHaveLength(1);
        expect(saved[0]).toMatchObject({ direction: "outbound", text: "发出" });
        expect(saved[0].time).toBeLessThanOrEqual(Date.now());
        history.close();
    });

    it("同一频道 ID 在不同服务器的记录与去重互不串联", () => {
        const history = store();
        for (const guildId of ["guild-a", "guild-b"]) {
            const message = projectOutboundChatMessage(
                "mock",
                "bot",
                {
                    scene_type: "channel",
                    scene_id: chatId("general"),
                    guild_id: chatId(guildId),
                    message: [{ type: "text", data: { text: guildId } }],
                },
                { message_id: chatId("same-message-id") },
            );
            history.append(message!);
            expect(
                history.history({
                    platform: "mock",
                    accountId: "bot",
                    sceneType: "channel",
                    sceneId: "general",
                    guildId,
                }),
            ).toMatchObject([{ text: guildId }]);
        }
        history.close();
    });

    it("旧版消息索引迁移后保留历史，并按服务器隔离新的频道消息", () => {
        const directory = mkdtempSync(join(tmpdir(), "onebots-chat-history-migrate-"));
        directories.push(directory);
        const file = join(directory, "chat.db");
        const first = new ChatHistoryStore(file);
        first.append(
            projectOutboundChatMessage(
                "mock",
                "bot",
                {
                    scene_type: "channel",
                    scene_id: chatId("general"),
                    guild_id: chatId("guild-a"),
                    message: [{ type: "text", data: { text: "旧消息" } }],
                },
                { message_id: chatId("same") },
            )!,
        );
        first.close();
        const legacy = new DatabaseSync(file);
        legacy.exec(`DROP TABLE chat_history_revision;
            DROP INDEX idx_chat_message_identity_v2;
            CREATE UNIQUE INDEX idx_chat_message_identity ON chat_messages
            (platform, account_id, scene_type, scene_id, message_id)
            WHERE message_id IS NOT NULL;
            PRAGMA user_version = 1;`);
        legacy.close();

        const migrated = new ChatHistoryStore(file);
        migrated.append(
            projectOutboundChatMessage(
                "mock",
                "bot",
                {
                    scene_type: "channel",
                    scene_id: chatId("general"),
                    guild_id: chatId("guild-b"),
                    message: [{ type: "text", data: { text: "新消息" } }],
                },
                { message_id: chatId("same") },
            )!,
        );
        const query = {
            platform: "mock",
            accountId: "bot",
            sceneType: "channel" as const,
            sceneId: "general",
        };
        expect(migrated.history({ ...query, guildId: "guild-a" })).toMatchObject([
            { text: "旧消息" },
        ]);
        expect(migrated.history({ ...query, guildId: "guild-b" })).toMatchObject([
            { text: "新消息" },
        ]);
        expect(migrated.historyPage({ ...query, guildId: "guild-a" }).revision).toMatch(
            /^[0-9a-f-]{36}$/,
        );
        migrated.close();
    });
});
