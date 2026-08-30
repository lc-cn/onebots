import { Adapter, type CommonTypes } from "onebots";
import { SlackAdapterBase } from "./adapter-base.js";
import { SlackError } from "./errors.js";
import { projectSlackMessageSegments } from "./events.js";
import { compileSlackMessage } from "./messages.js";
import type { SlackMessage } from "./types.js";

/** Slack 消息发送、读取、撤回与更新动作。 */
export abstract class SlackMessageActions extends SlackAdapterBase {
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const bot = this.requireAccount(uin).client;
        const sceneId = this.coerceId(params.scene_id as CommonTypes.Id | string | number);
        const { text, options, files } = compileSlackMessage(params.message);
        const channelId = sceneId.string;
        const result = files.length
            ? await bot.sendFiles(channelId, files, text, options)
            : await bot.sendMessage(channelId, text, options);
        if (!result.ts) {
            throw SlackError.protocol(
                "Slack 发送响应缺少消息时间戳",
                "SLACK_MESSAGE_TIMESTAMP_MISSING",
                result,
            );
        }
        bot.rememberMessage(result.ts, channelId, options.thread_ts);
        return { message_id: this.createId(result.ts) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const bot = this.requireAccount(uin).client;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const context = bot.getMessageContext(messageId);
        const channelId =
            params.scene_id != null
                ? this.coerceId(params.scene_id as CommonTypes.Id | string | number).string
                : context?.channel || "";
        if (!channelId) {
            throw SlackError.invalid(
                "Slack 删除消息需要 scene_id（频道 ID）",
                "SLACK_SCENE_ID_REQUIRED",
            );
        }
        await bot.deleteMessage(channelId, messageId);
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const bot = this.requireAccount(uin).client;
        const timestamp = params.message_id.string;
        const context = bot.getMessageContext(timestamp);
        const channel = params.scene_id?.string || context?.channel;
        if (!channel) {
            throw SlackError.invalid(
                "Slack 获取消息需要 scene_id（频道 ID）或已知消息上下文",
                "SLACK_SCENE_ID_REQUIRED",
            );
        }
        const result = await bot.call("conversations.replies", {
            channel,
            ts: context?.threadTs || timestamp,
            oldest: timestamp,
            latest: timestamp,
            inclusive: true,
            limit: 1,
        });
        const response = result as { messages?: SlackMessage[] };
        const message = response.messages?.find(item => item.ts === timestamp);
        if (!message?.ts) {
            throw SlackError.resource(
                `Slack 消息 ${timestamp} 不存在或当前 token 无权读取`,
                "SLACK_MESSAGE_NOT_FOUND",
                { message_id: timestamp, channel },
            );
        }
        const privateScene = channel.startsWith("D");
        return {
            message_id: this.createId(message.ts),
            time: Math.floor(Number(message.ts)),
            sender: {
                scene_type: privateScene ? "private" : "channel",
                sender_id: this.createId(message.user || ""),
                scene_id: this.createId(channel),
                sender_name: message.user || "",
                scene_name: "",
            },
            message: projectSlackMessageSegments(message),
        };
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const bot = this.requireAccount(uin).client;
        const messageId = this.coerceId(
            params.message_id as CommonTypes.Id | string | number,
        ).string;
        const rawScene = (
            params as Adapter.UpdateMessageParams & { scene_id?: CommonTypes.Id | string | number }
        ).scene_id;
        const context = bot.getMessageContext(messageId);
        const channelId =
            rawScene != null
                ? this.coerceId(rawScene as CommonTypes.Id | string | number).string
                : context?.channel || "";
        if (!channelId) {
            throw SlackError.invalid(
                "Slack 更新消息需要 scene_id（频道 ID）",
                "SLACK_SCENE_ID_REQUIRED",
            );
        }
        const { text, options, files } = compileSlackMessage(params.message);
        if (files.length) {
            throw SlackError.invalid(
                "Slack 更新消息不支持新增文件，请使用 call_slack_api",
                "SLACK_UPDATE_FILE_UNSUPPORTED",
            );
        }
        if (options.thread_ts) {
            throw SlackError.invalid(
                "Slack 更新消息不能改变所属线程",
                "SLACK_UPDATE_THREAD_UNSUPPORTED",
            );
        }
        await bot.updateMessage(channelId, messageId, text, options);
    }
}
