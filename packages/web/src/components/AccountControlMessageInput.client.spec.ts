import { createRenderer, h, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { ControlClient, ControlSendRequest } from "@onebots/core/control";
import AccountControlMessageInput from "./AccountControlMessageInput.vue";
import { useAccountSend } from "../use-account-send.js";
import type { AccountControlConversationItem } from "../account-control-list.js";

interface InputNode {
    tag: string;
    value: string;
    props: Record<string, unknown>;
    children: InputNode[];
}

// 使用真实组件的原生文本框事件，发送经过完整会话发送逻辑，只替换控制服务边界。
const node = (tag: string): InputNode => ({ tag, value: "", props: {}, children: [] });
const renderer = createRenderer<InputNode, InputNode>({
    createElement: node,
    createText: () => node("text"),
    createComment: () => node("comment"),
    insert: (child, parent) => parent.children.push(child),
    remove: () => {},
    patchProp(element, key, _previous, value) {
        element.props[key] = value;
    },
    setText: () => {},
    setElementText: () => {},
    parentNode: () => null,
    nextSibling: () => null,
});

function fixture() {
    const send = vi.fn(async (request: ControlSendRequest) => ({
        id: request.id,
        status: "succeeded" as const,
    }));
    const root = node("root");
    const app = renderer.createApp({
        setup() {
            const state = useAccountSend({
                client: {
                    sendMessage: send,
                    sendOperation: vi.fn(),
                } as unknown as Pick<ControlClient, "sendMessage" | "sendOperation">,
                account: () => "mock/bot",
                selected: ref<AccountControlConversationItem>({
                    kind: "friend",
                    id: "friend-1",
                    name: "好友",
                }),
                online: ref(true),
                canChat: ref(true),
                ensureContext: async () => ({
                    gatewayInstanceId: "00000000-0000-4000-8000-000000000001",
                    configVersion: "a".repeat(64),
                }),
                refreshHistory: () => {},
                operationStorage: { getItem: () => null, setItem: () => {} },
            });
            return () =>
                h(AccountControlMessageInput, {
                    modelValue: state.text.value,
                    disabled: false,
                    placeholder: "输入纯文本消息…",
                    "onUpdate:modelValue": value => {
                        state.text.value = value;
                    },
                    onSend: state.sendMessage,
                });
        },
    });
    app.mount(root);
    const input = root.children.find(child => child.tag === "textarea")!;
    function dispatch(name: string, event: object = {}) {
        const handler = input.props[name];
        if (typeof handler === "function") handler(event);
    }
    input.value = "中文草稿";
    dispatch("onInput");
    return { send, dispatch, close: () => app.unmount() };
}

describe("账号控制文本框发送快捷键", () => {
    it.each([
        { modifier: "ctrlKey", end: "onCompositionend" },
        { modifier: "metaKey", end: "onCompositionend" },
        { modifier: "ctrlKey", end: "onBlur" },
    ])("组合输入以 $end 结束后，$modifier + Enter 正常发送草稿", async ({ modifier, end }) => {
        const f = fixture();
        const preventDefault = vi.fn();
        try {
            f.dispatch("onCompositionstart");
            f.dispatch(end);
            f.dispatch("onKeydown", {
                key: "Enter",
                [modifier]: true,
                isComposing: false,
                preventDefault,
            });
            await vi.waitFor(() => expect(f.send).toHaveBeenCalledOnce());
            expect(f.send).toHaveBeenCalledWith(expect.objectContaining({ message: "中文草稿" }));
            expect(preventDefault).toHaveBeenCalledOnce();
        } finally {
            f.close();
        }
    });

    it("普通 Enter 留作换行，不产生发送请求", async () => {
        const f = fixture();
        const preventDefault = vi.fn();
        try {
            f.dispatch("onKeydown", { key: "Enter", isComposing: false, preventDefault });
            await Promise.resolve();
            expect(f.send).not.toHaveBeenCalled();
            expect(preventDefault).not.toHaveBeenCalled();
        } finally {
            f.close();
        }
    });
    it("组合输入生命周期仍在进行时，即使键盘事件未标记 composing 也不发送", async () => {
        const f = fixture();
        const preventDefault = vi.fn();
        try {
            f.dispatch("onCompositionstart");
            f.dispatch("onKeydown", {
                key: "Enter",
                metaKey: true,
                isComposing: false,
                preventDefault,
            });
            await Promise.resolve();
            expect(f.send).not.toHaveBeenCalled();
            expect(preventDefault).not.toHaveBeenCalled();
        } finally {
            f.close();
        }
    });
    it("输入法组词的 Ctrl+Enter 不产生发送请求，也不拦截候选确认", async () => {
        const f = fixture();
        const preventDefault = vi.fn();
        try {
            f.dispatch("onKeydown", {
                key: "Enter",
                ctrlKey: true,
                isComposing: true,
                preventDefault,
            });
            await Promise.resolve();
            expect(f.send).not.toHaveBeenCalled();
            expect(preventDefault).not.toHaveBeenCalled();
        } finally {
            f.close();
        }
    });
});
