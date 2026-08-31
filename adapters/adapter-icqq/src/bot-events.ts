import type { ICQQError } from "./errors.js";
import type {
    ICQQDiscussMessageEvent,
    ICQQFriendChangeEvent,
    ICQQGroupSignEvent,
    ICQQGroupTransferEvent,
    ICQQGuildMessageEvent,
    ICQQReadSyncEvent,
    ICQQTypingEvent,
} from "./extended-event-types.js";
import type {
    ICQQAuthEvent,
    ICQQDeviceEvent,
    ICQQFriendRecallEvent,
    ICQQFriendRequestEvent,
    ICQQGroupAdminEvent,
    ICQQGroupDecreaseEvent,
    ICQQGroupIncreaseEvent,
    ICQQGroupMessageEvent,
    ICQQGroupMuteEvent,
    ICQQGroupRecallEvent,
    ICQQGroupReactionEvent,
    ICQQGroupRequestEvent,
    ICQQLoginErrorEvent,
    ICQQOfflineEvent,
    ICQQPokeEvent,
    ICQQPrivateMessageEvent,
    ICQQQRCodeEvent,
    ICQQSliderEvent,
    ICQQUser,
} from "./types.js";

/** ICQQBot 对上层公开的完整事件契约。 */
export interface ICQQBotEvents {
    client_error: [error: ICQQError];
    ready: [user: ICQQUser];
    offline: [event: ICQQOfflineEvent];
    offline_network: [event: ICQQOfflineEvent];
    heartbeat_error: [error: ICQQError];
    stop_error: [error: ICQQError];
    qrcode: [event: ICQQQRCodeEvent];
    auth: [event: ICQQAuthEvent];
    slider: [event: ICQQSliderEvent];
    device: [event: ICQQDeviceEvent];
    login_error: [event: ICQQLoginErrorEvent];
    private_message: [event: ICQQPrivateMessageEvent];
    group_message: [event: ICQQGroupMessageEvent];
    discuss_message: [event: ICQQDiscussMessageEvent];
    guild_message: [event: ICQQGuildMessageEvent];
    synced_private_message: [event: ICQQPrivateMessageEvent];
    friend_request: [event: ICQQFriendRequestEvent];
    group_request: [event: ICQQGroupRequestEvent];
    group_increase: [event: ICQQGroupIncreaseEvent];
    group_decrease: [event: ICQQGroupDecreaseEvent];
    group_mute: [event: ICQQGroupMuteEvent];
    group_admin: [event: ICQQGroupAdminEvent];
    group_reaction: [event: ICQQGroupReactionEvent];
    friend_change: [event: ICQQFriendChangeEvent];
    group_sign: [event: ICQQGroupSignEvent];
    group_transfer: [event: ICQQGroupTransferEvent];
    read_sync: [event: ICQQReadSyncEvent];
    typing: [event: ICQQTypingEvent];
    friend_recall: [event: ICQQFriendRecallEvent];
    group_recall: [event: ICQQGroupRecallEvent];
    poke: [event: ICQQPokeEvent];
    stop: [];
}
