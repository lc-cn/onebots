import type {
    ControlAccountItem,
    ControlChatConversation,
    ControlChatMessage,
} from "@onebots/core/control";

export type AccountControlCategory = "friend" | "group" | "channel";
export type AccountControlTab = AccountControlCategory | "recent";
export interface AccountControlConversationItem extends ControlAccountItem {
    sceneType?: ControlChatMessage["sceneType"];
    latestText?: string;
    latestTime?: number;
    latestId?: number;
}

export function accountControlItemKey(item: AccountControlConversationItem): string {
    return JSON.stringify([item.kind, item.sceneType ?? "", item.parentId ?? "", item.id]);
}

export const accountControlCategories: ReadonlyArray<{
    id: AccountControlTab;
    label: string;
}> = [
    { id: "recent", label: "最近" },
    { id: "friend", label: "好友" },
    { id: "group", label: "群" },
    { id: "channel", label: "频道" },
];

export function manualAccountTargetLabel(
    category: AccountControlCategory,
    insideGuild: boolean,
    directChannels: boolean,
): string {
    if (category !== "channel" || insideGuild) return "目标 ID";
    return directChannels ? "频道 ID" : "服务器 ID";
}

export function accountControlSceneType(
    kind: ControlAccountItem["kind"] | undefined,
): "private" | "group" | "channel" {
    return kind === "friend" ? "private" : kind === "group" ? "group" : "channel";
}

export function recentAccountControlItem(
    conversation: ControlChatConversation,
): AccountControlConversationItem {
    const kind =
        conversation.sceneType === "group"
            ? "group"
            : conversation.sceneType === "channel"
              ? "channel"
              : "friend";
    const isPrivate = conversation.sceneType === "private";
    return {
        kind,
        id: conversation.sceneId,
        name:
            isPrivate && conversation.latest.direction === "inbound"
                ? conversation.latest.senderName
                : conversation.sceneId,
        subtitle: conversation.sceneType === "direct" ? "直聊会话" : undefined,
        ...(conversation.guildId ? { parentId: conversation.guildId } : {}),
        sceneType: conversation.sceneType,
        latestText: conversation.latest.text,
        latestTime: conversation.latest.time,
        latestId: conversation.latest.id,
    };
}

export interface AccountControlListState {
    items: AccountControlConversationItem[];
    loading: boolean;
    loaded: boolean;
    supported: boolean;
    truncated: boolean;
    error: string;
}

export function emptyAccountControlList(): AccountControlListState {
    return {
        items: [],
        loading: false,
        loaded: false,
        supported: true,
        truncated: false,
        error: "",
    };
}

export function filterAccountControlItems(
    items: readonly AccountControlConversationItem[],
    search: string,
): AccountControlConversationItem[] {
    const query = search.trim().toLocaleLowerCase();
    return query
        ? items.filter(item =>
              [item.name, item.id, item.subtitle].some(value =>
                  value?.toLocaleLowerCase().includes(query),
              ),
          )
        : [...items];
}
