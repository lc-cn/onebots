import { rm } from "node:fs/promises";
import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import { BaseApp, SqliteDB, type Account } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { isTeamsGroupConversation, TeamsAdapter } from "./adapter.js";
import type { TeamsConversationReference } from "./types.js";

const reference = (conversationType: string, isGroup = true): TeamsConversationReference => ({
    channelId: "msteams",
    conversation: { id: "conversation", conversationType, isGroup },
});

describe("Teams 会话资源分类", () => {
    it("只把 groupChat 投影为 canonical Group", () => {
        expect(isTeamsGroupConversation(reference("groupChat"))).toBe(true);
        expect(isTeamsGroupConversation(reference("channel"))).toBe(false);
        expect(isTeamsGroupConversation(reference("personal", false))).toBe(false);
    });

    it("manual 模式不挂载路由，webhook 模式允许自定义安全路径", async () => {
        const databasePath = `/tmp/onebots-teams-adapter-${process.pid}`;
        const database = new SqliteDB(databasePath);
        const post = vi.fn();
        const adapter = new TeamsAdapter({
            db: database,
            config: { general: {} },
            router: { post },
            getLogger: () => ({
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            }),
        } as unknown as BaseApp);
        const baseConfig: Account.Config<"teams"> = {
            platform: "teams",
            account_id: "work-agent",
            app_id: "00000000-0000-0000-0000-000000000000",
            app_password: "secret",
        };

        try {
            const account = adapter.createAccount({ ...baseConfig, receive_mode: "manual" });
            expect(post).not.toHaveBeenCalled();

            const dispatch = vi.fn();
            adapter.on("message:dispatch", dispatch);
            const activity = new Activity(ActivityTypes.Message);
            activity.id = "message-1";
            activity.timestamp = new Date("2026-08-30T00:00:00.000Z");
            activity.serviceUrl = "https://smba.trafficmanager.net/teams/";
            activity.channelId = "msteams";
            activity.from = { id: "user-native", name: "User" };
            activity.recipient = { id: "bot-native", name: "Agent" };
            activity.conversation = { id: "conversation-1", isGroup: false };
            activity.text = "hello";
            await account.client.ingest(activity);
            expect(dispatch).toHaveBeenCalledWith(
                expect.objectContaining({
                    event: expect.objectContaining({
                        bot_id: expect.objectContaining({ string: "bot-native" }),
                    }),
                }),
            );

            adapter.createAccount({
                ...baseConfig,
                receive_mode: "webhook",
                webhook_path: "/callbacks/teams",
            });
            expect(post).toHaveBeenCalledWith("/callbacks/teams", expect.any(Function));

            expect(() =>
                adapter.createAccount({
                    ...baseConfig,
                    receive_mode: "webhook",
                    webhook_path: "//external.example/callback",
                }),
            ).toThrow(/安全的绝对路径/u);
            expect(() =>
                adapter.createAccount({
                    ...baseConfig,
                    receive_mode: "socket" as never,
                }),
            ).toThrow(/仅支持 webhook 或 manual/u);
        } finally {
            database.close();
            await rm(`${databasePath}.db`, { force: true });
        }
    });
});
