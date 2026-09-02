import { Account, AccountStatus, Adapter, readPackageVersion, type CommonTypes } from "onebots";
import {
    displayName,
    materializeMattermostUpload,
    normalizeMattermostConfig,
} from "./adapter-support.js";
import { MattermostResourceAdapter } from "./adapter-resources.js";
import { MattermostClient } from "./client.js";
import { MattermostError } from "./errors.js";
import { projectMattermostEvent } from "./events.js";
import { compileMattermostMessage, projectMattermostPost } from "./messages.js";
import {
    executeMattermostPlatformAction,
    MATTERMOST_PLATFORM_ACTIONS,
} from "./platform-actions.js";
import type { MattermostChannel, MattermostDelivery, MattermostPost } from "./types.js";

export class MattermostAdapter extends MattermostResourceAdapter {
    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        const client = this.requireClient(uin);
        const channelId = await this.resolveSceneChannel(
            client,
            params.scene_type,
            params.scene_id,
        );
        const post = await client.createPost(compileMattermostMessage(channelId, params.message));
        return { message_id: this.createId(post.id) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        await this.requireClient(uin).deletePost(params.message_id.string);
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const client = this.requireClient(uin);
        return this.messageInfo(client, await client.getPost(params.message_id.string));
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        if (params.offset !== undefined) {
            throw MattermostError.invalid(
                "Mattermost 使用 page/before/after，不支持 canonical offset",
            );
        }
        const client = this.requireClient(uin);
        const channelId = await this.resolveSceneChannel(
            client,
            params.scene_type,
            params.scene_id,
        );
        const posts = await client.getPostsForChannel(channelId, {
            perPage: params.limit || 60,
            before: params.start_message_id?.string,
        });
        return Promise.all(posts.order.map(id => this.messageInfo(client, posts.posts[id])));
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const compiled = compileMattermostMessage("placeholder", params.message);
        await this.requireClient(uin).updatePost(params.message_id.string, {
            message: compiled.message,
            file_ids: compiled.file_ids,
        });
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        const client = this.requireClient(uin);
        const channelId = await this.resolveSceneChannel(
            client,
            params.scene_type,
            params.scene_id,
        );
        await client.markChannelRead(channelId);
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const result = await this.requireClient(uin).uploadFile(
            params.scene_id.string,
            materializeMattermostUpload(params),
            params.name,
        );
        const file = result.file_infos[0];
        if (!file) throw MattermostError.invalid("Mattermost 上传响应没有 file_info");
        return this.fileInfo(file);
    }

    async getFile(uin: string, params: Adapter.GetFileParams): Promise<Adapter.FileInfo> {
        return this.fileInfo(await this.requireClient(uin).getFileInfo(params.file_id.string));
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }

    async canSendRecord(): Promise<boolean> {
        return true;
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return MATTERMOST_PLATFORM_ACTIONS.has(action)
            ? executeMattermostPlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return MATTERMOST_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Mattermost Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Mattermost REST API v4 + WebSocket",
            version: "Mattermost v11.10 / API v4",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        if (!account) return { good: false };
        const online = account.status === AccountStatus.Online;
        const self = account.client.me?.id || account.account_id;
        return {
            online,
            good: online && (account.client.receiveMode === "manual" || account.client.isConnected),
            bots: [{ self: this.createId(self), online }],
        };
    }

    createAccount(config: Account.Config<"mattermost">): Account<"mattermost", MattermostClient> {
        const client = new MattermostClient(normalizeMattermostConfig(config), {
            reportError: error => this.logger.error("Mattermost Client 异常", error),
        });
        const account = new Account<"mattermost", MattermostClient>(this, client, config);
        client.on("event", (delivery: MattermostDelivery) =>
            account.dispatchManyAwaited(
                projectMattermostEvent(delivery, {
                    botId: this.createId(client.me?.id || account.account_id),
                    createId: value => this.createId(value),
                    resolveChannel: id => client.getCachedChannel(id),
                }),
            ),
        );
        client.on("missed", (expected, actual) =>
            this.logger.warn(
                `Mattermost WebSocket 事件序列缺口: expected=${expected}, actual=${actual}`,
            ),
        );
        client.on("error", error => this.logger.error("Mattermost 事件管线异常", error));
        account.on("start", async signal => {
            try {
                await client.start(signal);
                account.status = AccountStatus.Online;
                account.nickname = client.me ? displayName(client.me) : account.account_id;
                this.logger.info(
                    `Mattermost ${account.account_id} 已就绪（${client.receiveMode}）`,
                );
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Mattermost ${account.account_id} 失败`, error);
                throw error;
            }
        });
        account.on("stop", async () => {
            try {
                await client.stop();
            } finally {
                account.status = AccountStatus.OffLine;
            }
        });
        return account;
    }

    private async resolveSceneChannel(
        client: MattermostClient,
        scene: CommonTypes.Scene,
        id: CommonTypes.Id,
    ): Promise<string> {
        if (scene === "direct" || scene === "private") {
            return (await client.createDirectChannel(id.string)).id;
        }
        if (scene === "group" || scene === "channel") return id.string;
        throw MattermostError.invalid(`Mattermost 不支持 scene_type ${scene}`);
    }

    private async messageInfo(
        client: MattermostClient,
        post: MattermostPost,
    ): Promise<Adapter.MessageInfo> {
        const channel =
            client.getCachedChannel(post.channel_id) || (await client.getChannel(post.channel_id));
        const scene = this.sceneFor(channel.type);
        return {
            message_id: this.createId(post.id),
            time: Math.floor(post.create_at / 1_000),
            sender: {
                scene_type: scene,
                sender_id: this.createId(post.user_id),
                scene_id: this.createId(
                    scene === "direct" ? directPeer(channel.name, client.me?.id) : channel.id,
                ),
                sender_name: post.user_id,
                scene_name: channel.display_name || channel.name,
            },
            message: projectMattermostPost(post),
        };
    }

    private sceneFor(type: MattermostChannel["type"]): CommonTypes.Scene {
        if (type === "D") return "direct";
        if (type === "G") return "group";
        return "channel";
    }

    private fileInfo(file: Awaited<ReturnType<MattermostClient["getFileInfo"]>>): Adapter.FileInfo {
        return {
            file_id: this.createId(file.id),
            file_name: file.name,
            file_size: file.size,
            group_id: this.createId(file.channel_id),
            uploaded_time: Math.floor(file.create_at / 1_000),
            uploader_id: this.createId(file.user_id),
        };
    }
}

function directPeer(channelName: string, selfId?: string): string {
    const users = channelName.split("__");
    return users.find(id => id && id !== selfId) || channelName;
}
