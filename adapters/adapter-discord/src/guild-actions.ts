import { Adapter, CommonTypes } from "onebots";
import type { DiscordMember, DiscordMessage } from "./bot.js";
import { DiscordMessageActions } from "./message-actions.js";
import { ChannelType } from "./types.js";

/** Discord 消息投影与 Guild 成员角色判定的共享基础。 */
export abstract class DiscordGuildActions extends DiscordMessageActions {
    protected convertMessageToInfo(message: DiscordMessage): Adapter.MessageInfo {
        const segments: CommonTypes.Segment[] = [];
        if (message.content) {
            segments.push({ type: "text", data: { text: message.content } });
        }
        for (const attachment of message.attachments || []) {
            const type = attachment.content_type?.startsWith("image/")
                ? "image"
                : attachment.content_type?.startsWith("audio/")
                  ? "audio"
                  : attachment.content_type?.startsWith("video/")
                    ? "video"
                    : "file";
            segments.push({
                type,
                data: {
                    file: attachment.id,
                    url: attachment.url,
                    filename: attachment.filename,
                    content_type: attachment.content_type,
                },
            });
        }
        const sceneType: CommonTypes.Scene =
            message.channel.type === ChannelType.DM ? "private" : "channel";
        return {
            message_id: this.createId(message.id),
            time: Math.floor(message.createdTimestamp / 1000),
            sender: {
                scene_type: sceneType,
                sender_id: this.createId(message.author.id),
                scene_id: this.createId(message.channel.id),
                sender_name: message.author.username,
                scene_name: "",
            },
            message: segments,
        };
    }

    protected getMemberRole(member: DiscordMember): "owner" | "admin" | "member" {
        return member.roles && member.roles.length > 2 ? "admin" : "member";
    }
}
