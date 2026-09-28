/** 控制台聊天记录只包含展示所需的规范化文本，不包含平台原始事件或附件字节。 */
export interface ControlChatMessage {
    id: number;
    platform: string;
    accountId: string;
    sceneType: "private" | "direct" | "group" | "channel";
    sceneId: string;
    guildId?: string;
    messageId?: string;
    senderId: string;
    senderName: string;
    direction: "inbound" | "outbound";
    text: string;
    time: number;
}

export interface ControlChatHistorySettings {
    enabled: boolean;
    retentionDays: number;
}

export interface ControlChatHistoryQuery {
    platform: string;
    accountId: string;
    sceneType: ControlChatMessage["sceneType"];
    sceneId: string;
    guildId?: string;
    before?: number;
}

/** 修订号随清理或过期删除变化，使已翻阅的本地旧页能够准确失效。 */
export interface ControlChatHistoryPage {
    messages: ControlChatMessage[];
    revision: string;
}

/** 账号最近有记录的会话；不把平台联系人目录误当成聊天会话。 */
export interface ControlChatConversation {
    sceneType: ControlChatMessage["sceneType"];
    sceneId: string;
    guildId?: string;
    latest: ControlChatMessage;
}
