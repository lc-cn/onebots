import { describe, expect, it, vi } from "vitest";
import { MattermostClient } from "./client.js";
import type { MattermostRestTransport } from "./rest.js";
import type { MattermostConfig, MattermostWebSocketEvent } from "./types.js";

describe("MattermostClient", () => {
    it("manual start 验证身份、合并并发启动，并由 AbortSignal 终止生命周期", async () => {
        let release: (() => void) | undefined;
        const rest: MattermostRestTransport = {
            call: vi.fn().mockImplementation(
                () =>
                    new Promise(resolve => {
                        release = () => resolve(user("bot1"));
                    }),
            ),
        };
        const client = new MattermostClient(config(), { rest });
        const ready = vi.fn();
        const stopped = vi.fn();
        client.on("ready", ready);
        client.on("stop", stopped);
        const controller = new AbortController();
        const first = client.start(controller.signal);
        const second = client.start(controller.signal);
        release?.();
        await Promise.all([first, second]);

        expect(client.me).toMatchObject({ id: "bot1", username: "bot-bot1" });
        expect(ready).toHaveBeenCalledOnce();
        expect(rest.call).toHaveBeenCalledOnce();
        controller.abort(new Error("shutdown"));
        await vi.waitFor(() => expect(stopped).toHaveBeenCalledOnce());
        expect(client.isStarted).toBe(false);
    });

    it("ingest 过滤、去重且 handler 失败后允许可靠重试", async () => {
        const client = new MattermostClient(
            config({ event_types: ["posted"], channel_ids: ["channel1"] }),
            { rest: { call: vi.fn().mockResolvedValue(user("bot1")) } },
        );
        const handler = vi.fn().mockRejectedValueOnce(new Error("downstream failed"));
        client.on("event", handler);
        const packet = posted("post1", "channel1");

        await expect(client.ingest(packet)).rejects.toThrow("downstream failed");
        handler.mockResolvedValueOnce(undefined);
        await expect(client.ingest(packet)).resolves.toMatchObject({
            accepted: true,
            duplicate: false,
            filtered: false,
        });
        await expect(client.ingest(packet)).resolves.toMatchObject({
            accepted: false,
            duplicate: true,
        });
        await expect(client.ingest(posted("post2", "channel2"))).resolves.toMatchObject({
            filtered: true,
        });
        await expect(client.ingest(event("typing", {}, 5))).resolves.toMatchObject({
            filtered: true,
        });
    });

    it("拒绝 response envelope 进入 manual ingress", async () => {
        const client = new MattermostClient(config());
        await expect(client.ingest({ status: "OK", seq_reply: 1, data: {} })).rejects.toThrow(
            /只接受/u,
        );
    });

    it("完整遍历 200 条分页，并按 200 个 ID 分批解析用户", async () => {
        const call = vi.fn<MattermostRestTransport["call"]>();
        call.mockImplementation((_method, path, options) => {
            if (path === "users/me") return Promise.resolve(user("bot1"));
            if (path === "teams/team1/members") {
                const page = options?.query?.page;
                return Promise.resolve(
                    page === 0
                        ? Array.from({ length: 200 }, (_, index) => teamMember(`user${index}`))
                        : [teamMember("user200")],
                );
            }
            if (path === "users/ids") {
                const ids = options?.body as string[];
                return Promise.resolve(ids.map(user));
            }
            throw new Error(`unexpected ${path}`);
        });
        const client = new MattermostClient(config(), { rest: { call } });
        await client.start();
        const members = await client.listAllTeamMembers("team1");
        const users = await client.getUsersByIds(members.map(member => member.user_id));

        expect(members).toHaveLength(201);
        expect(users).toHaveLength(201);
        expect(call.mock.calls.filter(([, path]) => path === "teams/team1/members")).toHaveLength(
            2,
        );
        expect(call.mock.calls.filter(([, path]) => path === "users/ids")).toHaveLength(2);
    });
});

function config(overrides: Partial<MattermostConfig> = {}): MattermostConfig {
    return {
        account_id: "account",
        server_url: "https://chat.example.com",
        access_token: "token",
        receive_mode: "manual",
        ...overrides,
    };
}

function user(id: string) {
    return {
        id,
        create_at: 1,
        update_at: 1,
        delete_at: 0,
        username: `bot-${id}`,
    };
}

function teamMember(userId: string) {
    return {
        team_id: "team1",
        user_id: userId,
        roles: "team_user",
        delete_at: 0,
        scheme_user: true,
        scheme_admin: false,
        scheme_guest: false,
    };
}

function posted(postId: string, channelId: string): MattermostWebSocketEvent {
    return event(
        "posted",
        {
            post: JSON.stringify({
                id: postId,
                create_at: 1,
                update_at: 1,
                edit_at: 0,
                delete_at: 0,
                is_pinned: false,
                user_id: "user1",
                channel_id: channelId,
                root_id: "",
                original_id: "",
                message: "hello",
                type: "",
                props: {},
                hashtags: "",
                file_ids: [],
                pending_post_id: "",
            }),
        },
        1,
        channelId,
    );
}

function event(
    eventType: string,
    data: Record<string, unknown>,
    seq: number,
    channelId?: string,
): MattermostWebSocketEvent {
    return {
        event: eventType,
        data,
        broadcast: channelId ? { channel_id: channelId } : {},
        seq,
    };
}
