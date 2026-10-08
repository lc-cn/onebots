import { afterEach, describe, expect, it, vi } from "vitest";
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
const succeeded = (id: string) => ({ id, status: "succeeded" }) as ControlSendOperation;
afterEach(() => vi.unstubAllGlobals());

function fixture(
    send = vi
        .fn()
        .mockImplementation((request: { id: string }) => Promise.resolve(succeeded(request.id))),
) {
    const selected = ref<AccountControlConversationItem>();
    const account = ref("mock/bot");
    const refreshHistory = vi.fn();
    const client = {
        sendMessage: send,
        sendOperation: vi.fn().mockImplementation((id: string) => Promise.resolve(succeeded(id))),
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
    return { account, selected, state, send, client, refreshHistory };
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
        resolvePending(succeeded(f.send.mock.calls[0][0].id));
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

    it("纯文本保留用户输入的首尾空白、缩进与换行", async () => {
        const f = fixture();
        f.selected.value = friend;
        const message = "  第一行\n    第二行\n";
        f.state.text.value = message;
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ message }));
        expect(f.state.text.value).toBe("");
    });

    it("仅空白的草稿不发送，也不丢失输入", async () => {
        const f = fixture();
        f.selected.value = friend;
        f.state.text.value = "  \n\t";
        await f.state.sendMessage();
        expect(f.send).not.toHaveBeenCalled();
        expect(f.state.text.value).toBe("  \n\t");
        expect(f.state.pendingSendId.value).toBe("");
    });

    it("HTTP 页面没有 randomUUID 时仍用安全随机数生成合法发送编号", async () => {
        const getRandomValues = globalThis.crypto.getRandomValues.bind(globalThis.crypto);
        vi.stubGlobal("crypto", { getRandomValues });
        const f = fixture();
        f.selected.value = friend;
        f.state.text.value = "局域网控制消息";
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledWith(
            expect.objectContaining({
                id: expect.stringMatching(
                    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
                ),
            }),
        );
        expect(f.state.sendBusy.value).toBe(false);
    });

    it("安全随机数不可用时不发送、不遗留忙碌状态，保留草稿并提示", async () => {
        vi.stubGlobal("crypto", undefined);
        const f = fixture();
        f.selected.value = friend;
        f.state.text.value = "尚未发送";
        await expect(f.state.sendMessage()).resolves.toBeUndefined();
        expect(f.send).not.toHaveBeenCalled();
        expect(f.state.sendBusy.value).toBe(false);
        expect(f.state.pendingSendId.value).toBe("");
        expect(f.state.sendError.value).toContain("安全操作编号");
        expect(f.state.text.value).toBe("尚未发送");
    });

    it("中文消息超过字节预算时就地提示，不创建未知发送操作", async () => {
        const f = fixture();
        f.selected.value = friend;
        const draft = "中".repeat(11000);
        f.state.text.value = draft;
        await f.state.sendMessage();
        expect(f.send).not.toHaveBeenCalled();
        expect(f.state.pendingSendId.value).toBe("");
        expect(f.state.sendBusy.value).toBe(false);
        expect(f.state.sendError.value).toContain("32 KiB");
        expect(f.state.text.value).toBe(draft);
    });

    it.each([
        ["ASCII", "a".repeat(32768)],
        ["中文", "中".repeat(10922) + "ab"],
        ["Emoji", "🙂".repeat(8192)],
    ])("正文恰好 32 KiB 的 %s 消息仍可发送", async (_label, message) => {
        const f = fixture();
        f.selected.value = friend;
        f.state.text.value = message;
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledOnce();
        expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ message }));
        expect(f.state.pendingSendId.value).toBe("");
        expect(f.state.sendError.value).toBe("");
        expect(f.state.text.value).toBe("");
    });

    it("转义报文超限不创建操作，缩短草稿后可直接正常发送", async () => {
        const f = fixture();
        f.selected.value = friend;
        // 正文为 32 KiB，但 JSON 中双引号需转义，报文会超过 64,000 字节。
        const draft = '"'.repeat(32768);
        f.state.text.value = draft;
        await f.state.sendMessage();
        expect(f.send).not.toHaveBeenCalled();
        expect(f.state.pendingSendId.value).toBe("");
        expect(f.state.sendBusy.value).toBe(false);
        expect(f.state.text.value).toBe(draft);

        f.state.text.value = "已缩短的消息";
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledOnce();
        expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ message: "已缩短的消息" }));
        expect(f.state.sendError.value).toBe("");
        expect(f.state.text.value).toBe("");
    });

    it("发送响应编号不匹配时保留原操作与草稿，不把别人的成功当作本次结果", async () => {
        const f = fixture(
            vi.fn().mockResolvedValue(succeeded("00000000-0000-4000-8000-000000000099")),
        );
        f.selected.value = friend;
        f.state.text.value = "待确认消息";
        await f.state.sendMessage();

        expect(f.state.pendingSendId.value).toBe(f.send.mock.calls[0][0].id);
        expect(f.state.pendingStatus.value).toBe("unknown");
        expect(f.state.text.value).toBe("待确认消息");
        expect(f.refreshHistory).not.toHaveBeenCalled();
    });

    it("查询响应编号不匹配时仍阻止重复发送，可继续查询原编号", async () => {
        const f = fixture(vi.fn().mockRejectedValue(new Error("connection lost")));
        f.selected.value = friend;
        f.state.text.value = "可能已发出";
        await f.state.sendMessage();
        const originalId = f.state.pendingSendId.value;
        vi.mocked(f.client.sendOperation).mockResolvedValueOnce(
            succeeded("00000000-0000-4000-8000-000000000099"),
        );

        await f.state.querySend();
        expect(f.state.pendingSendId.value).toBe(originalId);
        expect(f.state.sendError.value).toContain("不可确认");
        expect(f.refreshHistory).not.toHaveBeenCalled();

        await f.state.querySend();
        expect(f.client.sendOperation).toHaveBeenLastCalledWith(originalId);
        expect(f.state.pendingSendId.value).toBe("");
        expect(f.refreshHistory).toHaveBeenCalledOnce();
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
            .mockImplementation((request: { id: string }) =>
                Promise.resolve(succeeded(request.id)),
            );
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
            .mockImplementation((request: { id: string }) =>
                Promise.resolve(succeeded(request.id)),
            );
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
        const send = vi
            .fn()
            .mockImplementation((request: { id: string }) =>
                Promise.resolve(succeeded(request.id)),
            );
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

    it("未知结果查询为执行中时恢复运行状态，不允许放弃后重复发送", async () => {
        const f = fixture(vi.fn().mockRejectedValue(new Error("connection lost")));
        f.selected.value = friend;
        f.state.text.value = "待确认消息";
        await f.state.sendMessage();
        const id = f.state.pendingSendId.value;
        f.state.requestAbandon();
        vi.mocked(f.client.sendOperation).mockResolvedValueOnce({
            ...succeeded(id),
            status: "running",
        });

        await f.state.querySend();
        expect(f.state.pendingStatus.value).toBe("running");
        expect(f.state.sendError.value).toContain("执行中");
        expect(f.state.confirmAbandon.value).toBe(false);
        f.state.requestAbandon();
        f.state.abandonTracking();
        expect(f.state.pendingSendId.value).toBe(id);
        await f.state.sendMessage();
        expect(f.send).toHaveBeenCalledOnce();
        expect(f.state.text.value).toBe("待确认消息");
    });

    it("查询回执期间不能放弃追踪，即使之前已打开二次确认", async () => {
        const f = fixture(vi.fn().mockRejectedValue(new Error("connection lost")));
        f.selected.value = friend;
        f.state.text.value = "可能已发出";
        await f.state.sendMessage();
        const id = f.state.pendingSendId.value;
        let resolveQuery!: (value: ControlSendOperation) => void;
        vi.mocked(f.client.sendOperation).mockReturnValueOnce(
            new Promise(resolve => {
                resolveQuery = resolve;
            }),
        );
        f.state.requestAbandon();
        const querying = f.state.querySend();
        expect(f.state.queryBusy.value).toBe(true);
        f.state.abandonTracking();
        expect(f.state.pendingSendId.value).toBe(id);
        f.state.cancelAbandon();
        f.state.requestAbandon();
        expect(f.state.confirmAbandon.value).toBe(false);

        resolveQuery({ ...succeeded(id), status: "unknown" });
        await querying;
        expect(f.state.queryBusy.value).toBe(false);
        f.state.requestAbandon();
        expect(f.state.confirmAbandon.value).toBe(true);
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
        const sendOperation = vi
            .fn()
            .mockImplementation((id: string) => Promise.resolve(succeeded(id)));
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
        const sendOperation = vi
            .fn()
            .mockImplementation((id: string) => Promise.resolve(succeeded(id)));
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
