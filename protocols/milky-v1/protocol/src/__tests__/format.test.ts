import { describe, expect, test, vi } from "vitest";
import type { CommonEvent } from "onebots";
import { projectMilkyEvent } from "../event-projector.js";

vi.mock("onebots", () => {
    class Protocol {
        public logger = {
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
            trace: vi.fn(),
        };

        constructor(
            public adapter: unknown,
            public account: unknown,
            public config: unknown,
        ) {}
    }

    return {
        Protocol,
        ProtocolRegistry: {
            registerSchema: vi.fn(),
            register: vi.fn(),
        },
        App: {
            registerGeneral: vi.fn(),
        },
        Account: class {},
        Adapter: class {},
        CommonEvent: {},
        CommonTypes: {},
        requirePositiveIntegerParam: (params: Record<string, unknown>, key: string) => {
            const value = Number(params[key]);
            if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError("invalid id");
            return value;
        },
        requireNonEmptyStringParam: (params: Record<string, unknown>, key: string) => {
            const value = params[key];
            if (typeof value !== "string" || value.trim() === "") {
                throw new TypeError("invalid string");
            }
            return value;
        },
        requireBooleanParam: (params: Record<string, unknown>, key: string) => {
            const value = params[key];
            if (typeof value !== "boolean") throw new TypeError("invalid boolean");
            return value;
        },
    };
});

const { MilkyV1 } = await import("../index.js");

function createProtocol() {
    const resolvedId = {
        string: "openid-123",
        number: 12345678,
        source: "openid-123",
    };

    const adapter = {
        app: {
            getLogger: vi.fn().mockReturnValue({
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
            }),
        },
        resolveId: vi.fn((id: string | number) => ({
            ...resolvedId,
            number: typeof id === "number" ? id : resolvedId.number,
        })),
        sendMessage: vi.fn(),
        deleteMessage: vi.fn(),
        kickGroupMember: vi.fn(),
        inviteGroupMember: vi.fn(),
        handleFriendRequest: vi.fn(),
        muteGroupMember: vi.fn(),
        setGroupAdmin: vi.fn(),
        setGroupCard: vi.fn(),
        setGroupName: vi.fn(),
        leaveGroup: vi.fn(),
        getLoginInfo: vi.fn(),
        getFriendList: vi.fn(),
        getGroupList: vi.fn(),
        getGroupMemberList: vi.fn(),
        getMessage: vi.fn(),
        getMessageHistory: vi.fn(),
        markMessageAsRead: vi.fn(),
        getVersion: vi.fn(),
        getStatus: vi.fn(),
        deleteFriend: vi.fn(),
        setAvatar: vi.fn(),
        setNickname: vi.fn(),
        setBio: vi.fn(),
        getCustomFaceUrlList: vi.fn(),
        setGroupSpecialTitle: vi.fn(),
        handleGroupRequest: vi.fn(),
        sendFriendNudge: vi.fn(),
        sendLike: vi.fn(),
        getFriendRequests: vi.fn(),
        sendGroupNudge: vi.fn(),
        getGroupNotifications: vi.fn(),
        muteGroupAll: vi.fn(),
        sendGroupAnnouncement: vi.fn(),
        getGroupFiles: vi.fn(),
        uploadFile: vi.fn(),
    };

    const protocol = new MilkyV1(
        adapter as never,
        { account_id: "bot" } as never,
        { protocol: "milky", version: "v1" } as never,
    );

    return { adapter, protocol, resolvedId };
}

// Helper to build realistic CommonEvent.Message objects
function textMsgEvent(overrides: Record<string, unknown> = {}) {
    return {
        id: { number: 1, string: "e1", source: "e1" },
        timestamp: 1700000000000,
        type: "message",
        platform: "qq",
        bot_id: { number: 12345678, string: "bot", source: "bot" },
        message_type: "private",
        sender: {
            id: { number: 10001, string: "u10001", source: "u10001" },
            name: "Alice",
        },
        message: [{ type: "text", data: { text: "Hello, world!" } }],
        raw_message: "Hello, world!",
        message_id: { number: 50001, string: "m50001", source: "m50001" },
        ...overrides,
    };
}

describe("Milky V1 protocol", () => {
    test("converts a private message to native message_receive", () => {
        const event = textMsgEvent();
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        expect(result).not.toBeNull();
        expect(result).toMatchObject({
            time: 1700000000,
            self_id: 12345678,
            event_type: "message_receive",
            data: {
                message_scene: "friend",
                peer_id: 10001,
                message_seq: 50001,
                sender_id: 10001,
                time: 1700000000,
                segments: [{ type: "text", data: { text: "Hello, world!" } }],
                friend: {
                    user_id: 10001,
                    nickname: "Alice",
                },
            },
        });
    });

    test("converts a group message with native scene data", () => {
        const event = textMsgEvent({
            message_type: "group",
            group: {
                id: { number: 20001, string: "g20001", source: "g20001" },
                name: "Test Group",
            },
        });
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            event_type: "message_receive",
            data: {
                message_scene: "group",
                peer_id: 20001,
                message_seq: 50001,
                sender_id: 10001,
                group: { group_id: 20001, group_name: "Test Group" },
            },
        });
    });

    test("preserves all message segments when raw_message is missing", () => {
        const event = textMsgEvent({
            raw_message: undefined,
            message: [
                { type: "text", data: { text: "Hello" } },
                { type: "image", data: { url: "http://example.com/img.png" } },
                { type: "text", data: { text: " World" } },
            ],
        });
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        if (result.event_type !== "message_receive") {
            throw new Error("期望转换为消息事件");
        }
        expect(result.data.segments).toEqual([
            { type: "text", data: { text: "Hello" } },
            {
                type: "image",
                data: {
                    resource_id: "http://example.com/img.png",
                    temp_url: "http://example.com/img.png",
                    width: 0,
                    height: 0,
                    summary: "",
                    sub_type: "normal",
                },
            },
            { type: "text", data: { text: " World" } },
        ]);
    });

    test("converts a group increase notice to native event data", () => {
        const event = {
            id: { number: 2, string: "e2", source: "e2" },
            timestamp: 1700000000000,
            type: "notice",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            notice_type: "group_increase",
            user: { id: { number: 10005, string: "u10005", source: "u10005" } },
            operator: { id: { number: 10001, string: "op10001", source: "op10001" } },
            group: { id: { number: 20001, string: "g20001", source: "g20001" } },
        };
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            time: 1700000000,
            self_id: 12345678,
            event_type: "group_member_increase",
            data: {
                user_id: 10005,
                operator_id: 10001,
                group_id: 20001,
            },
        });
    });

    test("converts a friend request to native friend_request", () => {
        const event = {
            id: { number: 3, string: "e3", source: "e3" },
            timestamp: 1700000000000,
            type: "request",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            request_type: "friend",
            user: { id: { number: 20002, string: "u20002", source: "u20002" } },
            comment: "hello",
            flag: "req-flag-001",
        };
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            time: 1700000000,
            self_id: 12345678,
            event_type: "friend_request",
            data: {
                initiator_id: 20002,
                initiator_uid: "req-flag-001",
                comment: "hello",
                is_filtered: false,
            },
        });
    });

    test("converts a group invitation while retaining its mapped request sequence", () => {
        const result = projectMilkyEvent({
            id: { number: 701, string: "opaque-group-flag", source: "opaque-group-flag" },
            timestamp: 1700000000000,
            type: "request",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            request_type: "group",
            sub_type: "invite",
            user: { id: { number: 10001, string: "u10001", source: "u10001" } },
            group: { id: { number: 20001, string: "g20001", source: "g20001" } },
            comment: "invite",
            flag: "opaque-group-flag",
        } as CommonEvent.Request);

        expect(result).toMatchObject({
            event_type: "group_invited_join_request",
            data: { group_id: 20001, notification_seq: 701 },
        });
    });

    test("converts lifecycle meta event to native bot event", () => {
        const event = {
            id: { number: 4, string: "e4", source: "e4" },
            timestamp: 1700000000000,
            type: "meta",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
            meta_type: "lifecycle",
            sub_type: "disable",
        };
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        expect(result).toMatchObject({
            time: 1700000000,
            self_id: 12345678,
            event_type: "bot_offline",
            data: {},
        });
    });

    test("does not invent Milky events for online lifecycle or heartbeat metadata", () => {
        const base = {
            id: { number: 4, string: "e4", source: "e4" },
            timestamp: 1700000000000,
            type: "meta",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
        };

        expect(
            projectMilkyEvent({
                ...base,
                meta_type: "lifecycle",
                sub_type: "connect",
            } as unknown as CommonEvent.Event),
        ).toBeNull();
        expect(
            projectMilkyEvent({
                ...base,
                meta_type: "heartbeat",
            } as unknown as CommonEvent.Event),
        ).toBeNull();
    });

    test("returns null for unknown event type", () => {
        const event = {
            id: { number: 99, string: "e99", source: "e99" },
            timestamp: 1700000000000,
            type: "unknown_type",
            platform: "qq",
            bot_id: { number: 12345678, string: "bot", source: "bot" },
        };
        const result = projectMilkyEvent(event as unknown as CommonEvent.Event)!;

        expect(result).toBeNull();
    });

    test("format wraps payload as a native event", () => {
        const { protocol } = createProtocol();
        const payload = { foo: "bar", count: 42 };
        const result = protocol.format("message", payload);

        expect(result).toEqual({
            time: expect.any(Number),
            self_id: 0,
            event_type: "message",
            data: { foo: "bar", count: 42 },
        });
    });

    test("apply supports native send_private_message", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.sendMessage = vi.fn().mockResolvedValue({
            message_id: { string: "msg-001", number: 9001 },
        });

        const result = await protocol.apply("send_private_message", {
            user_id: 10001,
            message: [{ type: "text", data: { text: "hi" } }],
        });

        expect(result).toMatchObject({
            status: "ok",
            retcode: 0,
            data: { message_seq: 9001, time: expect.any(Number) },
        });
        expect(adapter.sendMessage).toHaveBeenCalledWith("bot", {
            scene_type: "private",
            scene_id: expect.objectContaining({ number: 10001 }),
            message: [{ type: "text", data: { text: "hi" } }],
        });
    });

    test("message lookup, history, and read state use mapped Milky sequences", async () => {
        const { protocol, adapter } = createProtocol();
        const message = {
            message_id: { string: "native-message", number: 9001 },
            time: 1_700_000_000,
            sender: {
                scene_type: "private",
                sender_id: { string: "friend", number: 10001 },
                scene_id: { string: "friend", number: 10001 },
                sender_name: "Alice",
                scene_name: "",
            },
            message: [{ type: "text", data: { text: "hello" } }],
        };
        adapter.getMessage.mockResolvedValue(message);
        adapter.getMessageHistory.mockResolvedValue([message]);

        await expect(
            protocol.apply("get_message", {
                message_scene: "friend",
                peer_id: 10001,
                message_seq: 9001,
            }),
        ).resolves.toMatchObject({ data: { message_id: "native-message" } });
        await expect(
            protocol.apply("get_history_messages", {
                message_scene: "friend",
                peer_id: 10001,
                limit: 20,
            }),
        ).resolves.toMatchObject({ data: { messages: [{ message_id: "native-message" }] } });
        await expect(
            protocol.apply("mark_message_as_read", {
                message_scene: "friend",
                peer_id: 10001,
                message_seq: 9001,
            }),
        ).resolves.toMatchObject({ status: "ok" });
        expect(adapter.markMessageAsRead).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                scene_type: "private",
                message_id: expect.objectContaining({ number: 9001 }),
            }),
        );
    });

    test("apply maps native recall and group administration actions", async () => {
        const { protocol, adapter } = createProtocol();

        await expect(
            protocol.apply("recall_group_message", {
                group_id: 20001,
                message_seq: 9001,
            }),
        ).resolves.toMatchObject({ status: "ok" });
        await expect(
            protocol.apply("kick_group_member", {
                group_id: 20001,
                user_id: 10001,
                reject_add_request: true,
            }),
        ).resolves.toMatchObject({ status: "ok" });
        await expect(
            protocol.apply("invite_friend_to_group", {
                group_id: 20001,
                user_id: 10001,
            }),
        ).resolves.toMatchObject({ status: "ok", data: {} });
        await expect(
            protocol.apply("set_group_member_mute", {
                group_id: 20001,
                user_id: 10001,
                duration: 60,
            }),
        ).resolves.toMatchObject({ status: "ok" });

        expect(adapter.deleteMessage).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                scene_type: "group",
                message_id: expect.objectContaining({ number: 9001 }),
            }),
        );
        expect(adapter.kickGroupMember).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                reject_add_request: true,
            }),
        );
        expect(adapter.inviteGroupMember).toHaveBeenCalledWith("bot", {
            group_id: expect.objectContaining({ number: 20001 }),
            user_id: expect.objectContaining({ number: 10001 }),
        });
        expect(adapter.muteGroupMember).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                duration: 60,
            }),
        );
    });

    test("invite_friend_to_group rejects invalid IDs before reaching the adapter", async () => {
        const { protocol, adapter } = createProtocol();

        await expect(
            protocol.apply("invite_friend_to_group", { group_id: 0, user_id: "not-a-number" }),
        ).resolves.toMatchObject({ status: "failed", retcode: -1 });
        expect(adapter.inviteGroupMember).not.toHaveBeenCalled();
    });

    test("accept_friend_request preserves the opaque request flag", async () => {
        const { protocol, adapter } = createProtocol();

        await expect(
            protocol.apply("accept_friend_request", {
                initiator_uid: "opaque-request-flag",
                is_filtered: true,
                remark: "已验证",
            }),
        ).resolves.toMatchObject({ status: "ok", retcode: 0, data: {} });
        expect(adapter.handleFriendRequest).toHaveBeenCalledWith("bot", {
            flag: "opaque-request-flag",
            approve: true,
            remark: "已验证",
        });

        await expect(
            protocol.apply("accept_friend_request", { initiator_uid: " " }),
        ).resolves.toMatchObject({ status: "failed", retcode: -1 });
        expect(adapter.handleFriendRequest).toHaveBeenCalledTimes(1);
    });

    test("group request actions resolve the opaque ICQQ flag from the mapped sequence", async () => {
        const { protocol, adapter } = createProtocol();

        await expect(
            protocol.apply("accept_group_invitation", {
                group_id: 20001,
                invitation_seq: 701,
            }),
        ).resolves.toMatchObject({ status: "ok", retcode: 0 });
        expect(adapter.handleGroupRequest).toHaveBeenCalledWith("bot", {
            request_id: expect.objectContaining({ number: 701 }),
            type: "invitation",
            sub_type: "invite",
            approve: true,
            reason: undefined,
        });
    });

    test("delegates ICQQ friend, group, and file extensions through Adapter", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.getFriendRequests.mockResolvedValue([]);
        adapter.getGroupNotifications.mockResolvedValue([]);
        adapter.getGroupFiles.mockResolvedValue({ files: [], folders: [] });
        adapter.uploadFile.mockResolvedValue({
            file_id: { string: "fid", number: 801, source: "fid" },
            file_name: "demo.txt",
        });

        await expect(
            protocol.apply("send_profile_like", { user_id: 10001, count: 2 }),
        ).resolves.toMatchObject({ status: "ok" });
        await expect(
            protocol.apply("set_group_whole_mute", { group_id: 20001, enable: false }),
        ).resolves.toMatchObject({ status: "ok" });
        await expect(
            protocol.apply("get_group_files", { group_id: 20001, parent_folder_id: "/" }),
        ).resolves.toMatchObject({ data: { files: [], folders: [] } });
        await expect(
            protocol.apply("upload_private_file", {
                user_id: 10001,
                file: "base64://aGVsbG8=",
                name: "demo.txt",
            }),
        ).resolves.toMatchObject({ data: { file_id: "fid" } });

        expect(adapter.sendLike).toHaveBeenCalledWith("bot", expect.objectContaining({ count: 2 }));
        expect(adapter.muteGroupAll).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({ enable: false }),
        );
        expect(adapter.uploadFile).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({ data: "aGVsbG8=", scene_type: "private" }),
        );
    });

    test("returns implementation status and delegates special titles", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.getVersion.mockResolvedValue({
            app_name: "onebots ICQQ Adapter",
            app_version: "3.0.7",
        });
        adapter.getStatus.mockResolvedValue({ online: true, good: true });

        await expect(protocol.apply("get_impl_info", {})).resolves.toMatchObject({
            data: {
                impl_name: "onebots ICQQ Adapter",
                impl_version: "3.0.7",
                milky_version: "1.0",
            },
        });
        await expect(protocol.apply("get_status", {})).resolves.toMatchObject({
            data: { online: true, good: true },
        });
        await expect(
            protocol.apply("set_group_member_special_title", {
                group_id: 20001,
                user_id: 10001,
                special_title: "VIP",
                duration: -1,
            }),
        ).resolves.toMatchObject({ status: "ok" });
        expect(adapter.setGroupSpecialTitle).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({ special_title: "VIP", duration: -1 }),
        );
    });

    test("Milky 1.1 账号动作通过通用 Adapter seam 执行", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.getCustomFaceUrlList.mockResolvedValue(["https://example.com/face.png"]);

        await expect(protocol.apply("delete_friend", { user_id: 10001 })).resolves.toMatchObject({
            status: "ok",
            data: {},
        });
        await expect(
            protocol.apply("set_avatar", { uri: "base64://aGVsbG8=" }),
        ).resolves.toMatchObject({ status: "ok", data: {} });
        await protocol.apply("set_nickname", { new_nickname: "OneBots" });
        await protocol.apply("set_bio", { new_bio: "统一 IM 网关" });
        await protocol.apply("set_bio", { new_bio: "" });
        await expect(protocol.apply("get_custom_face_url_list", {})).resolves.toMatchObject({
            data: { urls: ["https://example.com/face.png"] },
        });

        expect(adapter.deleteFriend).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({ user_id: expect.objectContaining({ number: 10001 }) }),
        );
        expect(adapter.setAvatar).toHaveBeenCalledWith("bot", {
            source: "base64://aGVsbG8=",
        });
        expect(adapter.setNickname).toHaveBeenCalledWith("bot", { nickname: "OneBots" });
        expect(adapter.setBio).toHaveBeenCalledWith("bot", { bio: "统一 IM 网关" });
        expect(adapter.setBio).toHaveBeenLastCalledWith("bot", { bio: "" });
    });

    test("apply returns native Milky wrappers for login and list actions", async () => {
        const { protocol, adapter } = createProtocol();
        adapter.getLoginInfo.mockResolvedValue({
            user_id: { string: "bot", number: 12345678 },
            user_name: "Milky Bot",
        });
        adapter.getFriendList.mockResolvedValue([
            {
                user_id: { string: "friend", number: 10001 },
                user_name: "Alice",
                remark: "A",
            },
        ]);
        adapter.getGroupList.mockResolvedValue([
            {
                group_id: { string: "group", number: 20001 },
                group_name: "Test Group",
                member_count: 2,
                max_member_count: 500,
            },
        ]);
        adapter.getGroupMemberList.mockResolvedValue([
            {
                group_id: { string: "group", number: 20001 },
                user_id: { string: "friend", number: 10001 },
                user_name: "Alice",
                card: "Admin",
                role: "admin",
            },
        ]);

        await expect(protocol.apply("get_login_info", {})).resolves.toMatchObject({
            data: { uin: 12345678, nickname: "Milky Bot" },
        });
        await expect(protocol.apply("get_friend_list", {})).resolves.toMatchObject({
            data: { friends: [{ user_id: 10001 }] },
        });
        await expect(protocol.apply("get_group_list", {})).resolves.toMatchObject({
            data: { groups: [{ group_id: 20001 }] },
        });
        await expect(
            protocol.apply("get_group_member_list", { group_id: 20001 }),
        ).resolves.toMatchObject({
            data: { members: [{ group_id: 20001, user_id: 10001 }] },
        });
    });

    test("apply returns failure for unknown action", async () => {
        const { protocol } = createProtocol();
        const result = await protocol.apply("nonexistent_action", {});

        expect(result).toMatchObject({
            status: "failed",
            retcode: -1,
        });
        expect(result.message).toContain("Unknown action");
    });

    test("isMilkyShapedEvent detects objects with string event_type", () => {
        const { protocol } = createProtocol();

        expect(protocol["isMilkyShapedEvent"]({ event_type: "message_receive" })).toBe(true);
        expect(protocol["isMilkyShapedEvent"]({ event_type: "bot_offline", data: {} })).toBe(true);
    });

    test("isMilkyShapedEvent rejects non-objects and objects without event_type", () => {
        const { protocol } = createProtocol();

        expect(protocol["isMilkyShapedEvent"](null)).toBe(false);
        expect(protocol["isMilkyShapedEvent"](undefined)).toBe(false);
        expect(protocol["isMilkyShapedEvent"]("string")).toBe(false);
        expect(protocol["isMilkyShapedEvent"](42)).toBe(false);
        expect(protocol["isMilkyShapedEvent"]({})).toBe(false);
        expect(protocol["isMilkyShapedEvent"]({ event_type: 123 })).toBe(false);
    });
});
