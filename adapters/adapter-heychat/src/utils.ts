/**
 * 黑盒语音工具函数
 */
import type { HeychatCommandInfo, HeychatCommandOption } from "./types.js";

let ackSequence = 0;

/** 生成 heychat_ack_id，60 秒内不可重复 */
export function createHeychatAckId(): string {
    ackSequence = (ackSequence + 1) % Number.MAX_SAFE_INTEGER;
    return `${Date.now()}-${ackSequence}`;
}

/** 从命令信息重建命令文本 */
export function buildCommandText(command?: HeychatCommandInfo): string {
    if (!command?.name) return "";

    const parts: string[] = [command.name];
    if (command.options?.length) {
        for (const option of command.options) {
            appendOptionText(parts, option);
        }
    }
    return parts.join(" ").trim();
}

function appendOptionText(parts: string[], option: HeychatCommandOption): void {
    if (option.value !== undefined && option.value !== "") {
        parts.push(option.value);
        return;
    }
    if (option.choices?.length) {
        for (const choice of option.choices) {
            appendOptionText(parts, choice);
        }
    }
}

/**
 * 解析 scene_id：
 * - room_id:channel_id 复合格式
 * - 纯 channel_id（需结合 Bot 缓存）
 */
export function parseSceneId(sceneId: string): { room_id?: string; channel_id?: string } {
    if (sceneId.includes(":")) {
        const [roomId, channelId] = sceneId.split(":", 2);
        return { room_id: roomId, channel_id: channelId };
    }
    return { channel_id: sceneId };
}

/** 从 group/scene 标识中提取 room_id（兼容 room:channel 复合格式） */
export function extractRoomId(groupOrSceneId: string): string {
    if (groupOrSceneId.includes(":")) {
        return groupOrSceneId.split(":", 2)[0];
    }
    return groupOrSceneId;
}
