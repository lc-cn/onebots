import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";
import type {
    ControlAccountItem,
    ControlClient,
    ControlSendContext,
    ControlSendOperation,
} from "@onebots/core/control";
import { useAccountSend } from "./use-account-send.js";
import type { AccountControlConversationItem } from "./account-control-list.js";
import {
    readPendingAccountSends,
    type AccountSendOperationStorage,
} from "./account-send-recovery.js";

const expected: ControlSendContext = {
    gatewayInstanceId: "00000000-0000-4000-8000-000000000001",
    configVersion: "a".repeat(64),
};
const friend: ControlAccountItem = { kind: "friend", id: "friend-1", name: "好友" };
const group: ControlAccountItem = { kind: "group", id: "group-1", name: "群" };
const succeeded = { status: "succeeded" } as ControlSendOperation;

function fixture(send = vi.fn().mockResolvedValue(succeeded)) {
    const selected = ref<AccountControlConversationItem>();
    const account = ref("mock/bot");
    const refreshHistory = vi.fn();
    const client = {
        sendMessage: send,
        sendOperation: vi.fn().mockResolvedValue(succeeded),
    } as unknown as Pick<ControlClient, "sendMessage" | "sendOperation">;
    const state = useAccountSend({
        client,
        account: () => account.value,
        selected,
        online: ref(true),
        canChat: ref(true),
        ensureContext: async () => expected,
        refreshHistory,
    });
    return { account, selected, state, send, refreshHistory };
}

describe("账号控制会话发送", () => {
    it("为每个会话保留独立草稿，发送时固定原目标与场景", async () => {
        let resolvePending!: (value: ControlSendOperation) => void;
        const pending = new Promise<ControlSendOperation>(resolve => {
            resolvePending = resolve;
        });
        const f = fixture(vi.fn().mockReturnValue(pending));
        f.selected.value = friend;
        f.state.text.value = "发给好友";
        const sending = f.state.sendMessage();
        await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
        f.selected.value = group;
        expect(f.state.text.value).toBe("");
        f.state.text.value = "群草稿";
        expect(f.send.mock.calls[0][0]).toMatchObject({
            targetType: "private",
            targetId: "friend-1",
            message: "发给好友",
        });
        resolvePending(succeeded);
        await sending;
        expect(f.state.text.value).toBe("群草稿");
        expect(f.refreshHistory).not.toHaveBeenCalled();
        f.selected.value = friend;
        expect(f.state.text.value).toBe("");
        f.selected.value = group;
        expect(f.state.text.value).toBe("群草稿");
    });

    it("网络结果未知时保留幂等操作并避免重复发送", async () => {
        const f = fixture(vi.fn().mockRejectedValue(new Error("connection lost")));
        f.selected.value = friend;
        f.state.text.value = "可能已发出";
        await f.state.sendMessage();
        expect(f.state.pendingStatus.value).toBe("unknown");
        expect(f.state.pendingSendId.value).toBeTruthy();
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledOnce();
        expect(f.state.text.value).toBe("可能已发出");
    });

    it("最近的一对一历史始终按 private 场景发送", async () => {
        const f = fixture();
        f.selected.value = { ...friend, sceneType: "private" };
        f.state.text.value = "你好";
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ targetType: "private" }));
    });

    it("最近 direct 会话以独立会话 ID 发送，草稿和待确认操作不与同 ID 好友串联", async () => {
        const f = fixture(vi.fn().mockRejectedValue(new Error("connection lost")));
        const direct: AccountControlConversationItem = {
            kind: "friend",
            id: friend.id,
            name: "多人直聊",
            sceneType: "direct",
        };
        f.selected.value = direct;
        f.state.text.value = "多人消息";
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledWith(
            expect.objectContaining({ targetType: "direct", targetId: friend.id }),
        );
        expect(f.state.hasPending(direct)).toBe(true);
        expect(f.state.hasPending(friend)).toBe(false);
        f.selected.value = friend;
        expect(f.state.text.value).toBe("");
        expect(f.state.pendingSendId.value).toBe("");
    });

    it("切换账号保留旧账号待确认操作，不阻塞新账号发送", async () => {
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error("connection lost"))
            .mockResolvedValue(succeeded);
        const f = fixture(send);
        f.selected.value = friend;
        f.state.text.value = "旧账号消息";
        await f.state.sendMessage();
        const oldOperationId = f.state.pendingSendId.value;
        expect(oldOperationId).toBeTruthy();

        f.account.value = "mock/other";
        expect(f.state.pendingSendId.value).toBe("");
        expect(f.state.text.value).toBe("");
        f.state.text.value = "新账号消息";
        await f.state.sendMessage();
        expect(send.mock.calls[1][0]).toMatchObject({
            account: "mock/other",
            message: "新账号消息",
        });
        f.account.value = "mock/bot";
        expect(f.state.pendingSendId.value).toBe(oldOperationId);
        expect(f.state.pendingStatus.value).toBe("unknown");
    });

    it("未知发送只阻止原会话，其他会话可发送并在返回时继续查询", async () => {
        const send = vi
            .fn()
            .mockRejectedValueOnce(new Error("connection lost"))
            .mockResolvedValue(succeeded);
        const f = fixture(send);
        f.selected.value = friend;
        f.state.text.value = "好友消息";
        await f.state.sendMessage();
        const oldOperationId = f.state.pendingSendId.value;
        expect(f.state.hasPending(friend)).toBe(true);

        f.selected.value = group;
        expect(f.state.pendingSendId.value).toBe("");
        f.state.text.value = "群消息";
        await f.state.sendMessage();
        expect(send.mock.calls[1][0]).toMatchObject({ targetType: "group", message: "群消息" });
        f.selected.value = friend;
        expect(f.state.pendingSendId.value).toBe(oldOperationId);
        expect(f.state.hasPending(group)).toBe(false);
    });

    it("等待上下文时拒绝重复提交，并保留发送时的原始草稿", async () => {
        let resolveContext!: (value: ControlSendContext) => void;
        const context = new Promise<ControlSendContext>(resolve => {
            resolveContext = resolve;
        });
        const selected = ref<ControlAccountItem>(friend);
        const send = vi.fn().mockResolvedValue(succeeded);
        const state = useAccountSend({
            client: { sendMessage: send, sendOperation: vi.fn() } as unknown as Pick<
                ControlClient,
                "sendMessage" | "sendOperation"
            >,
            account: () => "mock/bot",
            selected,
            online: ref(true),
            canChat: ref(true),
            ensureContext: () => context,
            refreshHistory: vi.fn(),
        });
        state.text.value = "原始内容";
        const first = state.sendMessage();
        state.text.value = "后来修改";
        await state.sendMessage();
        resolveContext(expected);
        await first;
        expect(send).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ message: "原始内容" }));
        expect(state.text.value).toBe("后来修改");
    });

    it("放弃未知操作需要二次确认，确认期间仍可取消", async () => {
        const f = fixture(vi.fn().mockRejectedValue(new Error("connection lost")));
        f.selected.value = friend;
        f.state.text.value = "可能已发出";
        await f.state.sendMessage();
        f.state.abandonTracking();
        expect(f.state.pendingSendId.value).toBeTruthy();
        f.state.requestAbandon();
        f.state.cancelAbandon();
        expect(f.state.pendingSendId.value).toBeTruthy();
        f.state.requestAbandon();
        f.state.abandonTracking();
        expect(f.state.pendingSendId.value).toBe("");
    });

    it("离开并重新打开控制页后可查询原操作，不保存消息正文", async () => {
        const values = new Map<string, string>();
        const operationStorage: AccountSendOperationStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => {
                values.set(key, value);
            },
        };
        const selected = ref<ControlAccountItem>(friend);
        const sendMessage = vi.fn().mockRejectedValue(new Error("connection lost"));
        const sendOperation = vi.fn().mockResolvedValue(succeeded);
        const deps = {
            client: { sendMessage, sendOperation } as unknown as Pick<
                ControlClient,
                "sendMessage" | "sendOperation"
            >,
            account: () => "mock/bot",
            selected,
            online: ref(true),
            canChat: ref(true),
            ensureContext: async () => expected,
            refreshHistory: vi.fn(),
            operationStorage,
        };
        const first = useAccountSend(deps);
        first.text.value = "请不要存储这段正文";
        await first.sendMessage();
        const id = first.pendingSendId.value;
        expect(id).toBeTruthy();
        expect([...values.values()].join("")).not.toContain("请不要存储");

        const restored = useAccountSend(deps);
        expect(restored.pendingSendId.value).toBe(id);
        await restored.querySend();
        expect(sendOperation).toHaveBeenCalledWith(id);
        expect(restored.pendingSendId.value).toBe("");
        expect(deps.refreshHistory).toHaveBeenCalledOnce();
        expect(readPendingAccountSends(operationStorage).size).toBe(0);
    });

    it("重新打开控制页后仍能定位 direct 会话的未确认发送", async () => {
        const values = new Map<string, string>();
        const operationStorage: AccountSendOperationStorage = {
            getItem: key => values.get(key) ?? null,
            setItem: (key, value) => {
                values.set(key, value);
            },
        };
        const direct: AccountControlConversationItem = {
            kind: "friend",
            id: "room-1",
            name: "多人直聊",
            sceneType: "direct",
        };
        const selected = ref<AccountControlConversationItem>(direct);
        const sendOperation = vi.fn().mockResolvedValue(succeeded);
        const deps = {
            client: {
                sendMessage: vi.fn().mockRejectedValue(new Error("connection lost")),
                sendOperation,
            } as unknown as Pick<ControlClient, "sendMessage" | "sendOperation">,
            account: () => "mock/bot",
            selected,
            online: ref(true),
            canChat: ref(true),
            ensureContext: async () => expected,
            refreshHistory: vi.fn(),
            operationStorage,
        };
        const first = useAccountSend(deps);
        first.text.value = "可能已经发出";
        await first.sendMessage();
        const id = first.pendingSendId.value;
        expect(id).toBeTruthy();

        const restored = useAccountSend(deps);
        expect(restored.pendingSendId.value).toBe(id);
        expect(restored.hasPending(direct)).toBe(true);
        expect(restored.hasPending({ ...direct, sceneType: "private" })).toBe(false);
        await restored.querySend();
        expect(sendOperation).toHaveBeenCalledWith(id);
        expect(deps.refreshHistory).toHaveBeenCalledOnce();
        expect(readPendingAccountSends(operationStorage).size).toBe(0);
    });
});
