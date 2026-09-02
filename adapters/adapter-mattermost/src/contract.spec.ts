import { describe, expect, it, vi } from "vitest";
import type { ValidationRule } from "onebots";
import {
    describeMattermostCapabilities,
    MATTERMOST_EVENT_TYPES,
    mattermostCapabilities,
} from "./capabilities.js";
import { MattermostClient } from "./client.js";
import { mattermostSchema } from "./index.js";
import {
    executeMattermostPlatformAction,
    MATTERMOST_PLATFORM_ACTIONS,
} from "./platform-actions.js";
import type { MattermostRestTransport } from "./rest.js";

describe("Mattermost capability contract", () => {
    it("每个已发布平台动作都有 capability，且核心资源与传输准确声明", () => {
        for (const action of MATTERMOST_PLATFORM_ACTIONS) {
            expect(mattermostCapabilities.actions[action], action).toBeDefined();
        }
        expect(mattermostCapabilities.actions.send_message?.scenes).toEqual([
            "direct",
            "group",
            "channel",
        ]);
        expect(mattermostCapabilities.transports.existing_socket?.support).toBe("native");
        expect(mattermostCapabilities.transports.manual?.support).toBe("native");
        expect(mattermostCapabilities.segments.thread).toMatchObject({
            support: "native",
            direction: "both",
        });
    });

    it("按 event_types 收敛 canonical handler，并显式限制 manual WS actions", () => {
        const manifest = describeMattermostCapabilities({
            receive_mode: "manual",
            event_types: ["posted", "plugin_example"],
        });
        expect(manifest.events.message?.support).toBe("native");
        expect(manifest.events.custom?.support).toBe("native");
        expect(manifest.events.reaction_added?.support).toBe("unsupported");
        expect(manifest.actions.send_mattermost_typing?.support).toBe("unsupported");
        expect(
            describeMattermostCapabilities(
                { receive_mode: "manual", event_types: ["posted"] },
                true,
            ).actions.send_mattermost_typing?.support,
        ).toBe("native");
    });
});

describe("Mattermost Schema", () => {
    it("事件、Team 与 Channel 均使用可动态增减的 choice-list", () => {
        for (const field of ["event_types", "team_ids", "channel_ids"]) {
            expect(rule(field)).toMatchObject({
                type: "array",
                allowCustomValues: true,
                ui: { widget: "choice-list", section: "filter" },
            });
        }
        expect(rule("event_types").choices).toHaveLength(MATTERMOST_EVENT_TYPES.length);
    });

    it("token 敏感、模式明确且 WS 参数只在 websocket 模式展示", () => {
        expect(rule("access_token").sensitive).toBe(true);
        expect(rule("receive_mode").choices?.map(choice => choice.value)).toEqual([
            "websocket",
            "manual",
        ]);
        expect(rule("connect_timeout_ms").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["websocket"],
        });
        for (const [name, field] of Object.entries(mattermostSchema)) {
            expect(field.label, name).toBeTruthy();
            expect(field.ui?.section, name).toBeTruthy();
        }
    });
});

describe("Mattermost platform actions", () => {
    it("受控 generic call 与 scheduled posts 走 REST v4 相对路径", async () => {
        const call = vi.fn<MattermostRestTransport["call"]>().mockResolvedValue({ ok: true });
        const client = new MattermostClient(
            {
                account_id: "account",
                server_url: "https://chat.example.com",
                access_token: "token",
                receive_mode: "manual",
            },
            { rest: { call } },
        );
        await executeMattermostPlatformAction(client, "call_mattermost_api", {
            method: "GET",
            path: "users/me",
            query: { active: true },
        });
        await executeMattermostPlatformAction(client, "list_mattermost_scheduled_posts", {
            team_id: "team1",
            include_direct_channels: true,
        });
        await executeMattermostPlatformAction(client, "list_mattermost_channel_bookmarks", {
            channel_id: "channel1",
            bookmarks_since: 123,
        });

        expect(call).toHaveBeenNthCalledWith(1, "GET", "users/me", {
            query: { active: true },
            body: undefined,
        });
        expect(call).toHaveBeenNthCalledWith(2, "GET", "posts/scheduled/team/team1", {
            query: { include_direct_channels: true },
        });
        expect(call).toHaveBeenNthCalledWith(3, "GET", "channels/channel1/bookmarks", {
            query: { bookmarks_since: 123 },
        });
    });

    it("拒绝未知动作、绝对 API 路径和非法 channel type", async () => {
        const client = new MattermostClient({
            account_id: "account",
            server_url: "https://chat.example.com",
            access_token: "token",
            receive_mode: "manual",
        });
        await expect(executeMattermostPlatformAction(client, "unknown", {})).rejects.toMatchObject({
            code: "MATTERMOST_ACTION_NOT_IMPLEMENTED",
        });
        await expect(
            executeMattermostPlatformAction(client, "call_mattermost_api", {
                method: "GET",
                path: "https://evil.example.com/users",
            }),
        ).rejects.toThrow(/相对路径|无效路径/u);
        await expect(
            executeMattermostPlatformAction(client, "create_mattermost_channel", {
                team_id: "team1",
                name: "town-square",
                display_name: "Town Square",
                type: "D",
            }),
        ).rejects.toThrow(/O（公开）或 P/u);
        await expect(
            executeMattermostPlatformAction(client, "get_mattermost_statuses", {
                typo: true,
            }),
        ).rejects.toThrow(/不接受参数 typo/u);
    });
});

function rule(path: string): ValidationRule {
    const value = mattermostSchema[path];
    if (!value) throw new Error(`missing schema field ${path}`);
    return value;
}
