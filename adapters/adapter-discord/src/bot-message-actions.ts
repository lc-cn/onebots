import { wrapDiscordMessage, type DiscordMessage } from "./bot-model.js";
import { DiscordBotBase } from "./bot-base.js";
import { materializeDiscordFile, type DiscordFileInput } from "./media.js";
import { loadDiscordMessages } from "./resources.js";
import type { CreateMessageBody } from "./types.js";

/** Discord 消息、私信、附件与 Reaction 动作。 */
export abstract class DiscordBotMessageActions extends DiscordBotBase {
    async sendMessage(
        channelId: string,
        content: string | CreateMessageBody,
        files: DiscordFileInput[] = [],
    ): Promise<DiscordMessage> {
        const body = typeof content === "string" ? { content } : content;
        const uploads = await Promise.all(files.map(materializeDiscordFile));
        return wrapDiscordMessage(await this.getREST().createMessage(channelId, body, uploads));
    }

    async sendDM(
        userId: string,
        content: string | CreateMessageBody,
        files: DiscordFileInput[] = [],
    ): Promise<DiscordMessage> {
        const dmChannel = await this.getREST().request<{ id: string }>("/users/@me/channels", {
            method: "POST",
            body: { recipient_id: userId },
        });
        return this.sendMessage(dmChannel.id, content, files);
    }

    async sendEmbed(
        channelId: string,
        embeds: CreateMessageBody["embeds"],
    ): Promise<DiscordMessage> {
        return this.sendMessage(channelId, { embeds });
    }

    async sendWithAttachments(
        channelId: string,
        content: string,
        attachments: DiscordFileInput[],
    ): Promise<DiscordMessage> {
        return this.sendMessage(channelId, content, attachments);
    }

    async editMessage(
        channelId: string,
        messageId: string,
        content: string,
    ): Promise<DiscordMessage> {
        return wrapDiscordMessage(await this.getREST().editMessage(channelId, messageId, content));
    }

    async deleteMessage(channelId: string, messageId: string): Promise<void> {
        await this.getREST().deleteMessage(channelId, messageId);
    }

    async getMessage(channelId: string, messageId: string): Promise<DiscordMessage> {
        return wrapDiscordMessage(await this.getREST().getMessage(channelId, messageId));
    }

    async getMessageHistory(
        channelId: string,
        limit = 50,
        before?: string,
    ): Promise<Map<string, DiscordMessage>> {
        return loadDiscordMessages(this.getREST(), channelId, limit, before);
    }

    async addReaction(channelId: string, messageId: string, emoji: string): Promise<void> {
        await this.getREST().request(
            `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/@me`,
            { method: "PUT" },
        );
    }

    async removeReaction(
        channelId: string,
        messageId: string,
        emoji: string,
        userId?: string,
    ): Promise<void> {
        const target = userId || "@me";
        await this.getREST().request(
            `/channels/${channelId}/messages/${messageId}/reactions/${encodeURIComponent(emoji)}/${target}`,
            { method: "DELETE" },
        );
    }
}
