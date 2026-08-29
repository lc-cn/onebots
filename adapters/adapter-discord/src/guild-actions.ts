import { Adapter, CommonTypes } from "onebots";
import type { DiscordMember, DiscordMessage } from "./bot.js";
import { DiscordMessageActions } from "./message-actions.js";
import { ChannelType } from "./types.js";
import { projectDiscordMessageSegments } from "./events.js";

/** Discord 消息投影与 Guild 成员角色判定的共享基础。 */
export abstract class DiscordGuildActions extends DiscordMessageActions {
    protected convertMessageToInfo(message: DiscordMessage): Adapter.MessageInfo {
        const segments = projectDiscordMessageSegments(message, {
            createId: value => this.createId(value),
        });
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
