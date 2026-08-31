import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { executeICQQPlatformAction } from "./platform-actions.js";

describe("ICQQ 平台扩展动作", () => {
    it("路由 ICQQ 专属资料动作并保留底层返回值", async () => {
        const setDescription = vi.fn().mockResolvedValue(true);
        const client = { setDescription } as unknown as Client;

        await expect(
            executeICQQPlatformAction(client, "set_description", { description: "OneBots" }),
        ).resolves.toBe(true);
        expect(setDescription).toHaveBeenCalledWith("OneBots");
    });

    it("在进入 ICQQ 前严格拒绝错误参数", async () => {
        const client = {} as Client;
        await expect(
            executeICQQPlatformAction(client, "set_online_status", { status: "online" }),
        ).rejects.toMatchObject({ code: "ICQQ_INVALID_PARAM" });
        await expect(
            executeICQQPlatformAction(client, "send_temp_message", {
                group_id: 1,
                user_id: 2,
                message: "not-an-array",
            }),
        ).rejects.toThrow("message 必须是消息段数组");
        await expect(
            executeICQQPlatformAction(client, "set_group_join_type", {
                group_id: 1,
                type: "invalid",
            }),
        ).rejects.toThrow("type 必须是");
        await expect(
            executeICQQPlatformAction(client, "set_group_message_rate_limit", {
                group_id: 1,
                times: 3,
            }),
        ).rejects.toThrow("times 只能是 0、5 或 10");
    });

    it("字符串 QQ ID 可调用好友和群策略动作", async () => {
        const setRemark = vi.fn().mockResolvedValue(undefined);
        const getAtAllRemainder = vi.fn().mockResolvedValue(4);
        const client = {
            pickFriend: vi.fn(() => ({ setRemark })),
            pickGroup: vi.fn(() => ({ getAtAllRemainder })),
        } as unknown as Client;

        await executeICQQPlatformAction(client, "set_friend_remark", {
            user_id: "123456",
            remark: "同事",
        });
        await expect(
            executeICQQPlatformAction(client, "get_group_at_all_remainder", {
                group_id: "654321",
            }),
        ).resolves.toBe(4);
        expect(client.pickFriend).toHaveBeenCalledWith(123456);
        expect(client.pickGroup).toHaveBeenCalledWith(654321);
    });

    it("公开黑名单、好友分组与用户/群头像 URL", async () => {
        const getUserAvatarUrl = vi.fn().mockReturnValue("https://avatar/user");
        const getGroupAvatarUrl = vi.fn().mockReturnValue("https://avatar/group");
        const client = {
            blacklist: new Set([10001]),
            classes: new Map([[1, "同事"]]),
            pickUser: vi.fn(() => ({ getAvatarUrl: getUserAvatarUrl })),
            pickGroup: vi.fn(() => ({ getAvatarUrl: getGroupAvatarUrl })),
        } as unknown as Client;

        await expect(executeICQQPlatformAction(client, "get_blacklist", {})).resolves.toEqual([
            10001,
        ]);
        await expect(executeICQQPlatformAction(client, "get_friend_groups", {})).resolves.toEqual([
            { group_id: 1, group_name: "同事" },
        ]);
        await executeICQQPlatformAction(client, "get_user_avatar_url", {
            user_id: 10001,
            size: 100,
        });
        await executeICQQPlatformAction(client, "get_group_avatar_url", {
            group_id: 20001,
            size: 140,
            history: 1,
        });

        expect(getUserAvatarUrl).toHaveBeenCalledWith(100);
        expect(getGroupAvatarUrl).toHaveBeenCalledWith(140, 1);
    });

    it("删除表态前校验消息归属并使用原生 seq", async () => {
        const delReaction = vi.fn().mockResolvedValue({ ok: true });
        const client = {
            getMsg: vi.fn().mockResolvedValue({
                message_type: "group",
                group_id: 100,
                seq: 42,
            }),
            pickGroup: vi.fn(() => ({ delReaction })),
        } as unknown as Client;

        await expect(
            executeICQQPlatformAction(client, "delete_group_message_reaction", {
                message_id: "message",
                group_id: "100",
                face_id: 66,
                face_type: 1,
            }),
        ).resolves.toEqual({ ok: true });
        expect(delReaction).toHaveBeenCalledWith(42, "66", 1);
        await expect(
            executeICQQPlatformAction(client, "delete_group_message_reaction", {
                message_id: "message",
                group_id: 101,
                face_id: 66,
            }),
        ).rejects.toThrow("消息不属于指定群");
    });

    it("发送频道原生分享并严格校验应用配置", async () => {
        const share = vi.fn().mockResolvedValue(undefined);
        const client = {
            pickGuild: vi.fn(() => ({ channels: new Map([["channel", { share }]]) })),
        } as unknown as Client;

        await executeICQQPlatformAction(client, "send_channel_share", {
            guild_id: "guild",
            channel_id: "channel",
            url: "https://example.com",
            title: "OneBots",
            summary: "统一 IM 网关",
            config: { appid: 100, appname: "OneBots" },
        });

        expect(share).toHaveBeenCalledWith(
            expect.objectContaining({ url: "https://example.com", title: "OneBots" }),
            { appid: 100, appname: "OneBots", appsign: undefined },
        );
        await expect(
            executeICQQPlatformAction(client, "send_channel_share", {
                guild_id: "guild",
                channel_id: "channel",
                url: "https://example.com",
                title: "OneBots",
                config: { appid: "100" },
            }),
        ).rejects.toThrow("config.appid 必须是安全整数");
    });

    it("读取群文件系统并跨群转发文件", async () => {
        const file = {
            fid: "file",
            pid: "/",
            name: "demo.txt",
            user_id: 1,
            create_time: 1,
            modify_time: 1,
            is_dir: false,
            size: 5,
            busid: 1,
            md5: "md5",
            sha1: "sha1",
            duration: 0,
            download_times: 0,
        };
        const df = vi.fn().mockResolvedValue({ total: 100, used: 5, free: 95 });
        const stat = vi.fn().mockResolvedValue(file);
        const forward = vi.fn().mockResolvedValue({ ...file, fid: "forwarded" });
        const client = {
            acquireGfs: vi.fn((groupId: number) => (groupId === 1 ? { df, stat } : { forward })),
        } as unknown as Client;

        await expect(
            executeICQQPlatformAction(client, "get_group_file_system_info", { group_id: 1 }),
        ).resolves.toEqual({ total: 100, used: 5, free: 95 });
        await expect(
            executeICQQPlatformAction(client, "get_group_file_info", {
                group_id: 1,
                file_id: "file",
            }),
        ).resolves.toEqual(file);
        await executeICQQPlatformAction(client, "forward_group_file", {
            source_group_id: 1,
            target_group_id: 2,
            file_id: "file",
            target_folder_id: "/target",
            name: "copy.txt",
            send: true,
        });

        expect(forward).toHaveBeenCalledWith(file, "/target", "copy.txt", true);
    });

    it("保留 ICQQ 离线文件查询与转发能力", async () => {
        const getFileInfo = vi.fn().mockResolvedValue({ fid: "file", url: "https://file" });
        const forwardFile = vi.fn().mockResolvedValue("forwarded");
        const forwardOfflineFile = vi.fn().mockResolvedValue({ fid: "group-file" });
        const client = {
            pickUser: vi.fn(() => ({ getFileInfo })),
            pickFriend: vi.fn(() => ({ forwardFile })),
            acquireGfs: vi.fn(() => ({ forwardOfflineFile })),
        } as unknown as Client;

        await executeICQQPlatformAction(client, "get_offline_file_info", {
            user_id: 1,
            file_id: "file",
        });
        await executeICQQPlatformAction(client, "forward_offline_file", {
            user_id: 1,
            file_id: "file",
            group_id: 2,
            send: true,
        });
        await executeICQQPlatformAction(client, "forward_offline_file_to_group", {
            group_id: 2,
            file_id: "file",
            name: "copy.txt",
            send: false,
        });

        expect(getFileInfo).toHaveBeenCalledWith("file");
        expect(forwardFile).toHaveBeenCalledWith("file", 2, true);
        expect(forwardOfflineFile).toHaveBeenCalledWith("file", "copy.txt", false);
    });
});
