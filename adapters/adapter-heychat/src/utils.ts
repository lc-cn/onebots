/**
 * 黑盒语音工具函数
 */
import type {
    HeychatChannelMessageData,
    HeychatCommandInfo,
    HeychatCommandOption,
    HeychatMessageEvent,
    HeychatUseCommandData,
} from './types.js';

/** 生成 heychat_ack_id，60 秒内不可重复 */
export function createHeychatAckId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** 从命令信息重建命令文本 */
export function buildCommandText(command?: HeychatCommandInfo): string {
    if (!command?.name) return '';

    const parts: string[] = [command.name];
    if (command.options?.length) {
        for (const option of command.options) {
            appendOptionText(parts, option);
        }
    }
    return parts.join(' ').trim();
}

function appendOptionText(parts: string[], option: HeychatCommandOption): void {
    if (option.value !== undefined && option.value !== '') {
        parts.push(option.value);
        return;
    }
    if (option.choices?.length) {
        for (const choice of option.choices) {
            appendOptionText(parts, choice);
        }
    }
}

/** 解析 type=50 命令事件 */
export function parseCommandEvent(data: HeychatUseCommandData): HeychatMessageEvent | null {
    const roomId = data.room_base_info?.room_id;
    const channelId = data.channel_base_info?.channel_id;
    const userId = data.sender_info?.user_id;
    if (!roomId || !channelId || userId === undefined) return null;

    const rawMessage = buildCommandText(data.command_info);
    return {
        source: 'command',
        bot_id: data.bot_id,
        room_id: roomId,
        room_name: data.room_base_info?.room_name,
        channel_id: channelId,
        channel_name: data.channel_base_info?.channel_name,
        channel_type: data.channel_base_info?.channel_type,
        msg_id: data.msg_id || `${data.send_time || Date.now()}`,
        send_time: data.send_time || Date.now(),
        user_id: userId,
        nickname: data.sender_info?.nickname || data.sender_info?.room_nickname || String(userId),
        avatar: data.sender_info?.avatar,
        raw_message: rawMessage,
        command_id: data.command_info?.id,
        command_name: data.command_info?.name,
    };
}

/** 解析 type=5 普通频道消息（实验性） */
export function parseChannelMessageEvent(data: HeychatChannelMessageData): HeychatMessageEvent | null {
    const roomId = data.room_base_info?.room_id;
    const channelId = data.channel_base_info?.channel_id;
    const userId = data.sender_info?.user_id;
    if (!roomId || !channelId || userId === undefined) return null;

    const rawMessage = (data.msg || data.content || data.text || '').trim();
    if (!rawMessage) return null;

    return {
        source: 'channel',
        bot_id: data.bot_id,
        room_id: roomId,
        room_name: data.room_base_info?.room_name,
        channel_id: channelId,
        channel_name: data.channel_base_info?.channel_name,
        channel_type: data.channel_base_info?.channel_type,
        msg_id: data.msg_id || `${data.send_time || Date.now()}`,
        send_time: data.send_time || Date.now(),
        user_id: userId,
        nickname: data.sender_info?.nickname || data.sender_info?.room_nickname || String(userId),
        avatar: data.sender_info?.avatar,
        raw_message: rawMessage,
    };
}

/**
 * 解析 scene_id：
 * - room_id:channel_id 复合格式
 * - 纯 channel_id（需结合 Bot 缓存）
 */
export function parseSceneId(sceneId: string): { room_id?: string; channel_id?: string } {
    if (sceneId.includes(':')) {
        const [roomId, channelId] = sceneId.split(':', 2);
        return { room_id: roomId, channel_id: channelId };
    }
    return { channel_id: sceneId };
}

/** 从 group/scene 标识中提取 room_id（兼容 room:channel 复合格式） */
export function extractRoomId(groupOrSceneId: string): string {
    if (groupOrSceneId.includes(':')) {
        return groupOrSceneId.split(':', 2)[0];
    }
    return groupOrSceneId;
}
