import { rm } from "node:fs/promises";
import type { Account as DouyinAccount, GroupJoinRequest } from "douyin-im";
import {
    assertAdapterCapabilityContract,
    BaseApp,
    SqliteDB,
    type Account,
    type CommonTypes,
} from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DouyinAdapter } from "./adapter.js";
import { douyinCapabilities } from "./capabilities.js";

vi.mock("douyin-im", () => ({
    createClient: vi.fn(() => ({ createAccount: vi.fn() })),
}));
vi.mock("douyin-im/protocol", () => ({ parseMessageContent: vi.fn() }));
vi.mock("./account.js", () => ({
    DouyinAccountFactory: class {
        create(): never {
            throw new Error("测试不创建真实抖音账号");
        }
    },
}));

const databasePath = `/tmp/onebots-douyin-adapter-${process.pid}`;
const id = (source: string): CommonTypes.Id => ({ source, string: source, number: 1 });

describe("DouyinAdapter 审查契约", () => {
    let database: SqliteDB;
    let adapter: DouyinAdapter;

    beforeEach(() => {
        database = new SqliteDB(databasePath);
        adapter = new DouyinAdapter({
            db: database,
            dataDir: "/tmp",
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
    });

    afterEach(async () => {
        vi.useRealTimers();
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("按账号隔离同 requestId，并在调用上游前原子 claim", async () => {
        const firstSdk = {} as DouyinAccount;
        const secondSdk = {} as DouyinAccount;
        rememberAccount(adapter, "first", firstSdk);
        rememberAccount(adapter, "second", secondSdk);

        const pending = Promise.withResolvers<{ statusCode: number; statusMsg: string }>();
        const first = groupRequest(
            firstSdk,
            "same",
            vi.fn(() => pending.promise),
        );
        const secondApprove = vi.fn(async () => ({ statusCode: 0, statusMsg: "" }));
        const second = groupRequest(secondSdk, "same", secondApprove);
        adapter.rememberGroupRequest(first);
        adapter.rememberGroupRequest(second);

        const handling = adapter.handleGroupRequest("first", requestParams({ flag: "same" }));
        await expect(
            adapter.handleGroupRequest("first", requestParams({ flag: "same" })),
        ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
        pending.reject(new Error("上游失败"));
        await expect(handling).rejects.toThrow("上游失败");
        await expect(
            adapter.handleGroupRequest("first", requestParams({ flag: "same" })),
        ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });

        await adapter.handleGroupRequest("second", requestParams({ flag: "same" }));
        expect(secondApprove).toHaveBeenCalledOnce();
    });

    it("接受事件 request_id 的 request: 前缀，并拒绝不匹配的申请语义", async () => {
        const sdk = {} as DouyinAccount;
        rememberAccount(adapter, "account", sdk);
        const approve = vi.fn(async () => ({ statusCode: 0, statusMsg: "" }));
        adapter.rememberGroupRequest(groupRequest(sdk, "join-1", approve));

        for (const invalid of [
            { type: "invitation" as const },
            { sub_type: "invite" as const },
            { approve: false, block: true },
        ]) {
            await expect(
                adapter.handleGroupRequest("account", requestParams(invalid)),
            ).rejects.toMatchObject({ code: "PARAM_UNSUPPORTED" });
        }

        await adapter.handleGroupRequest(
            "account",
            requestParams({ flag: undefined, request_id: adapter.createId("request:join-1") }),
        );
        expect(approve).toHaveBeenCalledOnce();

        const rawPrefixedApprove = vi.fn(async () => ({ statusCode: 0, statusMsg: "" }));
        adapter.rememberGroupRequest(groupRequest(sdk, "request:raw", rawPrefixedApprove));
        await adapter.handleGroupRequest("account", requestParams({ flag: "request:raw" }));
        expect(rawPrefixedApprove).toHaveBeenCalledOnce();
    });

    it("淘汰过期申请，且总容量保持有界", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-10-09T00:00:00Z"));
        const sdk = {} as DouyinAccount;
        rememberAccount(adapter, "account", sdk);
        adapter.rememberGroupRequest(groupRequest(sdk, "expired"));
        vi.advanceTimersByTime(15 * 60 * 1000 + 1);
        await expect(
            adapter.handleGroupRequest("account", requestParams({ flag: "expired" })),
        ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });

        for (let index = 0; index <= 1_024; index += 1) {
            adapter.rememberGroupRequest(groupRequest(sdk, `request-${index}`));
        }
        await expect(
            adapter.handleGroupRequest("account", requestParams({ flag: "request-0" })),
        ).rejects.toMatchObject({ code: "REQUEST_NOT_FOUND" });
        await expect(
            adapter.handleGroupRequest("account", requestParams({ flag: "request-1024" })),
        ).resolves.toBeUndefined();
    });

    it("no_cache 绕过好友与群成员缓存", async () => {
        const cachedFriend = { uid: "friend", nickname: "旧好友" };
        const freshFriend = { uid: "friend", nickname: "新好友" };
        const getFriendList = vi.fn(async () => [freshFriend]);
        const sdk = {
            fl: new Map([["friend", cachedFriend]]),
            getFriendList,
            pickFriend: vi.fn(() => cachedFriend),
        } as unknown as DouyinAccount;
        rememberAccount(adapter, "account", sdk);

        await expect(adapter.getFriendList("account", {})).resolves.toMatchObject([
            { user_name: "新好友" },
        ]);
        await expect(adapter.getFriendList("account", { no_cache: true })).resolves.toMatchObject([
            { user_name: "新好友" },
        ]);
        await expect(
            adapter.getFriendInfo("account", { user_id: id("friend"), no_cache: true }),
        ).resolves.toMatchObject({ user_name: "新好友" });
        expect(getFriendList).toHaveBeenCalledTimes(3);
        expect(sdk.pickFriend).not.toHaveBeenCalled();

        const cachedMember = { uid: "member", nickname: "旧成员", roleName: "member" };
        const freshMember = { uid: "member", nickname: "新成员", roleName: "member" };
        const group = {
            groupId: "group",
            pickMember: vi.fn(() => cachedMember),
            getMemberList: vi.fn(async () => new Map([["member", freshMember]])),
        };
        const groupSdk = {
            getGroupList: vi.fn(async () => [group]),
            pickGroup: vi.fn(() => group),
        } as unknown as DouyinAccount;
        rememberAccount(adapter, "group-account", groupSdk);
        await expect(
            adapter.getGroupMemberInfo("group-account", {
                group_id: id("group"),
                user_id: id("member"),
                no_cache: true,
            }),
        ).resolves.toMatchObject({ user_name: "新成员" });
        expect(groupSdk.pickGroup).not.toHaveBeenCalled();
        expect(group.pickMember).not.toHaveBeenCalled();
        expect(group.getMemberList).toHaveBeenCalledWith(true);

        group.pickMember.mockReturnValue(undefined);
        await expect(
            adapter.getGroupMemberInfo("group-account", {
                group_id: id("group"),
                user_id: id("member"),
            }),
        ).resolves.toMatchObject({ user_name: "新成员" });
        expect(groupSdk.pickGroup).toHaveBeenCalledWith("group");
        expect(group.getMemberList).toHaveBeenLastCalledWith(true);
    });

    it("撤回接受 douyin-im 的 200 成功码", async () => {
        const recallMsg = vi.fn(async () => ({ statusCode: 200, statusMsg: "", recalled: true }));
        const contact = { recallMsg };
        const sdk = {
            pickFriend: vi.fn(() => contact),
        } as unknown as DouyinAccount;
        rememberAccount(adapter, "account", sdk);

        await expect(
            adapter.deleteMessage("account", {
                message_id: id("message"),
                scene_type: "private",
                scene_id: id("friend"),
            }),
        ).resolves.toBeUndefined();
        await expect(
            adapter.deleteMessage("account", {
                message_id: id("message"),
                scene_type: "direct",
                scene_id: id("friend"),
            }),
        ).resolves.toBeUndefined();
    });

    it("多操作消息在任何平台发送前失败", async () => {
        const sendMsg = vi.fn();
        const sdk = { pickFriend: vi.fn(() => ({ sendMsg })) } as unknown as DouyinAccount;
        rememberAccount(adapter, "account", sdk);

        await expect(
            adapter.sendMessage("account", {
                scene_type: "private",
                scene_id: id("friend"),
                message: [
                    { type: "text", data: { text: "正文" } },
                    { type: "image", data: { file: "image.png" } },
                ],
            }),
        ).rejects.toMatchObject({ code: "MESSAGE_MULTI_OPERATION_UNSUPPORTED" });
        expect(sendMsg).not.toHaveBeenCalled();
    });

    it("能力清单与实现闭合，且只公开抖音真实支持的消息场景", async () => {
        await assertAdapterCapabilityContract(adapter);
        expect(douyinCapabilities.actions.send_message?.scenes).toEqual([
            "private",
            "direct",
            "group",
        ]);
        expect(douyinCapabilities.actions.delete_message).toMatchObject({
            availability: "context",
            scenes: ["private", "direct", "group"],
        });
        expect(douyinCapabilities.actions.mark_message_as_read).toMatchObject({
            availability: "context",
            scenes: ["private", "direct", "group"],
        });
        expect(douyinCapabilities.events.message?.scenes).toEqual(["private", "group"]);
    });
});

function rememberAccount(adapter: DouyinAdapter, accountId: string, sdk: DouyinAccount): void {
    adapter.accounts.set(accountId, { client: sdk } as Account<"douyin", DouyinAccount>);
}

function groupRequest(
    sdk: DouyinAccount,
    requestId: string,
    approve = vi.fn(async () => ({ statusCode: 0, statusMsg: "" })),
): GroupJoinRequest {
    return {
        account: sdk,
        requestId,
        approve,
        reject: vi.fn(async () => ({ statusCode: 0, statusMsg: "" })),
    } as unknown as GroupJoinRequest;
}

function requestParams(
    override: Partial<Parameters<DouyinAdapter["handleGroupRequest"]>[1]> = {},
): Parameters<DouyinAdapter["handleGroupRequest"]>[1] {
    return { flag: "join-1", type: "request", approve: true, ...override };
}
