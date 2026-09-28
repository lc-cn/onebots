import { createRenderer, h, shallowReactive } from "vue";
import { vi } from "vitest";
import type {
    ControlAccountExploreRequest,
    ControlAccountExploreResult,
    ControlAccountItem,
    ControlChatMessage,
    ControlChatConversation,
    ControlChatHistoryQuery,
    ControlClient,
    ControlSendContext,
    ControlStatus,
} from "@onebots/core/control";
import { useAccountControl, type AccountControlProps } from "./use-account-control.js";

interface HostNode {
    children: HostNode[];
    parent?: HostNode;
    text?: string;
}

const renderer = createRenderer<HostNode, HostNode>({
    patchProp: () => {},
    insert(child, parent) {
        child.parent = parent;
        parent.children.push(child);
    },
    remove(child) {
        if (child.parent)
            child.parent.children = child.parent.children.filter(item => item !== child);
    },
    createElement: () => ({ children: [] }),
    createText: text => ({ children: [], text }),
    createComment: text => ({ children: [], text }),
    setText(node, text) {
        node.text = text;
    },
    setElementText(node, text) {
        node.text = text;
    },
    parentNode: node => node.parent ?? null,
    nextSibling: () => null,
});

export const expected: ControlSendContext = {
    gatewayInstanceId: "00000000-0000-4000-8000-000000000001",
    configVersion: "a".repeat(64),
};
export const friend: ControlAccountItem = { kind: "friend", id: "friend-1", name: "好友" };
export const group: ControlAccountItem = { kind: "group", id: "group-1", name: "群" };
export const status: ControlStatus = {
    schemaVersion: 1,
    manager: { id: "test", version: "1.0.0" },
    accounts: {
        available: true,
        items: [{ platform: "mock", accountId: "bot", status: "online" }],
    },
    gateway: {
        desired: "running",
        actual: "running",
        instance: { id: expected.gatewayInstanceId },
        recoveryRequired: false,
        operations: [],
    },
};
export const message = (id: number): ControlChatMessage => ({
    id,
    platform: "mock",
    accountId: "bot",
    sceneType: "private",
    sceneId: friend.id,
    senderId: friend.id,
    senderName: friend.name,
    direction: "inbound",
    text: `消息 ${id}`,
    time: id,
});

export function result(
    request: ControlAccountExploreRequest,
    overrides: Partial<ControlAccountExploreResult> = {},
): ControlAccountExploreResult {
    return {
        expected,
        account: request.account,
        action: request.action,
        supported: true,
        items: [],
        sendScenes: { private: true, direct: true, group: true, channel: true },
        truncated: false,
        ...overrides,
    };
}

export function mountControl(
    options: {
        mobile?: boolean;
        context?: () => Promise<ControlSendContext>;
        explore?: (request: ControlAccountExploreRequest) => Promise<ControlAccountExploreResult>;
        history?: (
            query: ControlChatHistoryQuery,
        ) => Promise<{ messages: ControlChatMessage[]; revision?: string }>;
        conversations?: (
            platform: string,
            accountId: string,
            before?: number,
        ) => Promise<{ conversations: ControlChatConversation[]; hasMore: boolean }>;
    } = {},
) {
    vi.stubGlobal("window", {
        location: { origin: "http://localhost" },
        matchMedia: () => ({ matches: Boolean(options.mobile) }),
    });
    const explore = vi.fn(
        options.explore ??
            (async (request: ControlAccountExploreRequest) =>
                result(request, { items: request.action === "friends" ? [friend] : [] })),
    );
    const chatHistory = vi.fn(async (query: ControlChatHistoryQuery) => ({
        revision: "fixture-revision",
        ...(await (options.history?.(query) ?? Promise.resolve({ messages: [] }))),
    }));
    const chatConversations = vi.fn(
        options.conversations ?? (async () => ({ conversations: [], hasMore: false })),
    );
    const sendMessage: ControlClient["sendMessage"] = vi.fn();
    const client = {
        sendContext: vi.fn(options.context ?? (async () => expected)),
        exploreAccount: explore,
        chatHistory,
        chatConversations,
        sendMessage,
        sendOperation: vi.fn(),
    } as unknown as ControlClient;
    const props = shallowReactive<AccountControlProps>({
        client,
        platform: "mock",
        accountId: "bot",
        status,
    });
    let control!: ReturnType<typeof useAccountControl>;
    const app = renderer.createApp({
        setup() {
            control = useAccountControl(props);
            return () => h("div");
        },
    });
    app.mount({ children: [] });
    return {
        control,
        props,
        explore,
        chatHistory,
        chatConversations,
        sendMessage,
        close: () => app.unmount(),
    };
}
