import { describe, expect, test, vi } from "vitest";

vi.mock("onebots", () => {
    class Protocol {
        constructor(
            public adapter: any,
            public account: any,
            public config: any,
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
    };
});

const { OneBotV11Protocol } = await import("../../../protocols/onebot-v11/protocol/src/index.ts");

function createProtocol() {
    const resolvedId = { string: "openid-123", number: 123456789, source: "openid-123" };
    const adapter = {
        resolveId: vi.fn((id: string | number) => ({
            ...resolvedId,
            number: typeof id === "number" ? id : resolvedId.number,
        })),
        sendMessage: vi.fn().mockResolvedValue({
            message_id: { string: "msg-1", number: 1, source: "msg-1" },
        }),
        deleteMessage: vi.fn().mockResolvedValue(undefined),
        getMessage: vi.fn().mockResolvedValue({
            time: 0,
            message_id: { string: "msg-1", number: 1, source: "msg-1" },
            sender: {
                scene_type: "private",
                sender_id: resolvedId,
                sender_name: "tester",
            },
            message: [],
        }),
        getUserInfo: vi.fn().mockResolvedValue({
            user_id: resolvedId,
            user_name: "tester",
        }),
        getGroupInfo: vi.fn().mockResolvedValue({
            group_id: resolvedId,
            group_name: "group",
            member_count: 1,
            max_member_count: 2,
        }),
        getGroupMemberInfo: vi.fn().mockResolvedValue({
            user_id: resolvedId,
            user_name: "tester",
            card: "",
            role: "member",
        }),
        getGroupMemberList: vi.fn().mockResolvedValue([]),
    };

    const protocol = new OneBotV11Protocol(
        adapter as any,
        { account_id: "bot" } as any,
        { protocol: "onebot", version: "v11" } as any,
    );

    return { adapter, protocol, resolvedId };
}

describe("OneBot V11 ID resolution", () => {
    test("send_private_msg resolves numeric-string user_id through adapter.resolveId()", async () => {
        const { adapter, protocol, resolvedId } = createProtocol();

        await protocol["sendPrivateMsg"]({
            user_id: "123456789",
            message: "hello",
        });

        expect(adapter.resolveId).toHaveBeenCalledWith(123456789);
        expect(adapter.sendMessage).toHaveBeenCalledWith(
            "bot",
            expect.objectContaining({
                scene_type: "private",
                scene_id: expect.objectContaining(resolvedId),
            }),
        );
    });

    test("message and info APIs resolve numeric-string IDs through adapter.resolveId()", async () => {
        const { adapter, protocol } = createProtocol();

        await protocol["deleteMsg"]({ message_id: "10001" });
        await protocol["getMsg"]({ message_id: "10002" });
        await protocol["getStrangerInfo"]({ user_id: "10003" });
        await protocol["getGroupInfo"]({ group_id: "10004" });
        await protocol["getGroupMemberInfo"]({ group_id: "10005", user_id: "10006" });
        await protocol["getGroupMemberList"]({ group_id: "10007" });

        expect(adapter.resolveId).toHaveBeenNthCalledWith(1, 10001);
        expect(adapter.resolveId).toHaveBeenNthCalledWith(2, 10002);
        expect(adapter.resolveId).toHaveBeenNthCalledWith(3, 10003);
        expect(adapter.resolveId).toHaveBeenNthCalledWith(4, 10004);
        expect(adapter.resolveId).toHaveBeenNthCalledWith(5, 10005);
        expect(adapter.resolveId).toHaveBeenNthCalledWith(6, 10006);
        expect(adapter.resolveId).toHaveBeenNthCalledWith(7, 10007);
    });
});
