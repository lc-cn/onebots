import {
    Account,
    AccountStatus,
    Adapter,
    BaseApp,
    readPackageVersion,
    type AdapterCapabilityManifest,
    type CommonTypes,
} from "onebots";
import { MatrixAppserviceHost } from "./appservice-host.js";
import { materializeMatrixUpload, normalizeMatrixConfig } from "./adapter-support.js";
import { MatrixClient } from "./client.js";
import { describeMatrixCapabilities, matrixCapabilities } from "./capabilities.js";
import {
    applyPowerLevels,
    parseJoinedRooms,
    parseMembers,
    parseProfile,
    parseRoomState,
    parseRoomSummary,
} from "./entities.js";
import { MatrixError } from "./errors.js";
import { projectMatrixEvent } from "./events.js";
import { compileMatrixMessages, projectMatrixMessageContent } from "./messages.js";
import { executeMatrixPlatformAction, MATRIX_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { MatrixEventEnvelope, MatrixRawEvent, MatrixRoomMember } from "./types.js";

export class MatrixAdapter extends Adapter<MatrixClient, "matrix"> {
    private readonly reactions = new Map<string, string>();
    private readonly appserviceHost: MatrixAppserviceHost;

    constructor(app: BaseApp) {
        super(app, "matrix", matrixCapabilities);
        this.icon = "https://matrix.org/favicon.ico";
        this.appserviceHost = new MatrixAppserviceHost(
            app,
            accountId => this.getAccount(accountId)?.client,
        );
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const config = uin ? this.getAccount(uin)?.client.config : undefined;
        return config ? describeMatrixCapabilities(config) : matrixCapabilities;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        if (params.scene_type !== "group" && params.scene_type !== "direct") {
            throw new MatrixError("Matrix 消息目标必须是 group 或 direct room", {
                code: "MATRIX_UNSUPPORTED_SCENE",
            });
        }
        const client = this.requireClient(uin);
        const contents = compileMatrixMessages(params.message);
        let firstEventId: string | undefined;
        for (const content of contents) {
            const sent = await client.sendEvent(params.scene_id.string, "m.room.message", content);
            firstEventId ||= sent.event_id;
        }
        if (!firstEventId)
            throw new MatrixError("Matrix 未返回消息事件 ID", {
                code: "MATRIX_EMPTY_SEND_RESPONSE",
            });
        return { message_id: this.createId(firstEventId) };
    }

    async deleteMessage(uin: string, params: Adapter.DeleteMessageParams): Promise<void> {
        const client = this.requireClient(uin);
        const eventId = params.message_id.string;
        await client.redact(this.requireRoom(client, eventId, params.scene_id?.string), eventId);
    }

    async getMessage(uin: string, params: Adapter.GetMessageParams): Promise<Adapter.MessageInfo> {
        const client = this.requireClient(uin);
        const eventId = params.message_id.string;
        const roomId = this.requireRoom(client, eventId, params.scene_id?.string);
        return this.toMessage(await client.getEvent(roomId, eventId), roomId);
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        if (params.offset !== undefined) {
            throw new MatrixError("Matrix 历史接口使用分页 token，不支持数字 offset", {
                code: "MATRIX_UNSUPPORTED_SEMANTICS",
            });
        }
        const client = this.requireClient(uin);
        const events = params.start_message_id
            ? await client
                  .getEventContext(
                      params.scene_id.string,
                      params.start_message_id.string,
                      params.limit,
                  )
                  .then(context => [
                      ...context.events_before,
                      ...(context.event ? [context.event] : []),
                      ...context.events_after,
                  ])
            : await client
                  .getMessages(params.scene_id.string, { limit: params.limit, direction: "b" })
                  .then(page => page.chunk);
        return events
            .filter(event => event.type === "m.room.message" || event.type === "m.sticker")
            .map(event => this.toMessage(event, params.scene_id.string));
    }

    async updateMessage(uin: string, params: Adapter.UpdateMessageParams): Promise<void> {
        const client = this.requireClient(uin);
        const eventId = params.message_id.string;
        const roomId = this.requireRoom(client, eventId);
        const contents = compileMatrixMessages(params.message);
        if (contents.length !== 1) {
            throw new MatrixError("Matrix 编辑消息必须编译为单个 m.room.message 事件", {
                code: "MATRIX_EDIT_MULTIPLE_EVENTS",
            });
        }
        await client.sendEvent(roomId, "m.room.message", {
            ...contents[0],
            "m.new_content": contents[0],
            "m.relates_to": { rel_type: "m.replace", event_id: eventId },
        });
    }

    async markMessageAsRead(uin: string, params: Adapter.MarkMessageAsReadParams): Promise<void> {
        if (!params.message_id) throw MatrixError.invalid("Matrix 回执必须提供 message_id");
        await this.requireClient(uin).call(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(params.scene_id.string)}/receipt/m.read/${encodeURIComponent(params.message_id.string)}`,
            { body: {} },
        );
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        return this.getUserInfo(uin, { user_id: this.createId(this.requireClient(uin).userId) });
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        const userId = params.user_id.string;
        const profile = parseProfile(
            await this.requireClient(uin).call(
                "GET",
                `/_matrix/client/v3/profile/${encodeURIComponent(userId)}`,
            ),
            userId,
        );
        return {
            user_id: this.createId(userId),
            user_name: profile.displayname || userId,
            user_displayname: profile.displayname,
            avatar: profile.avatar_url,
        };
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const client = this.requireClient(uin);
        const rooms = parseJoinedRooms(await client.call("GET", "/_matrix/client/v3/joined_rooms"));
        return Promise.all(rooms.map(roomId => this.loadGroupInfo(client, roomId)));
    }

    async getGroupInfo(
        uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        return this.loadGroupInfo(this.requireClient(uin), params.group_id.string);
    }

    async setGroupName(uin: string, params: Adapter.SetGroupNameParams): Promise<void> {
        await this.putState(this.requireClient(uin), params.group_id.string, "m.room.name", {
            name: params.group_name,
        });
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        if (params.is_dismiss) {
            throw new MatrixError("Matrix 离开房间不支持同时解散房间", {
                code: "MATRIX_UNSUPPORTED_SEMANTICS",
            });
        }
        await this.requireClient(uin).call(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(params.group_id.string)}/leave`,
            { body: {} },
        );
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const members = await this.loadMembers(this.requireClient(uin), params.group_id.string);
        return members
            .filter(member => member.membership === "join")
            .map(member => this.toMember(params.group_id, member));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const member = (
            await this.loadMembers(this.requireClient(uin), params.group_id.string)
        ).find(item => item.user_id === params.user_id.string && item.membership === "join");
        if (!member)
            throw new MatrixError("Matrix 房间中不存在该成员", {
                code: "MATRIX_MEMBER_NOT_FOUND",
                status: 404,
            });
        return this.toMember(params.group_id, member);
    }

    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        await this.roomMemberCall(
            this.requireClient(uin),
            params.group_id.string,
            "invite",
            params.user_id.string,
        );
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        if (params.reject_add_request) {
            throw new MatrixError("Matrix kick 不支持永久拒绝后续加入", {
                code: "MATRIX_UNSUPPORTED_SEMANTICS",
            });
        }
        await this.roomMemberCall(
            this.requireClient(uin),
            params.group_id.string,
            "kick",
            params.user_id.string,
        );
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        if (params.type !== "invitation" || !params.group_id) {
            throw new MatrixError("Matrix 仅能通过该动作处理当前机器人的房间邀请", {
                code: "MATRIX_UNSUPPORTED_SEMANTICS",
            });
        }
        if (params.block)
            throw new MatrixError("Matrix 拒绝邀请不支持 block 语义", {
                code: "MATRIX_UNSUPPORTED_SEMANTICS",
            });
        const action = params.approve ? "join" : "leave";
        await this.requireClient(uin).call(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(params.group_id.string)}/${action}`,
            { body: params.reason ? { reason: params.reason } : {} },
        );
    }

    async sendGroupMessageReaction(
        uin: string,
        params: Adapter.SendGroupMessageReactionParams,
    ): Promise<void> {
        if (params.reaction_type !== "emoji")
            throw MatrixError.invalid("Matrix reaction_type 必须是 emoji");
        const client = this.requireClient(uin);
        const key = `${uin}\u0000${params.group_id.string}\u0000${params.message_id.string}\u0000${params.reaction}`;
        if (params.is_add) {
            const sent = await client.sendEvent(params.group_id.string, "m.reaction", {
                "m.relates_to": {
                    rel_type: "m.annotation",
                    event_id: params.message_id.string,
                    key: params.reaction,
                },
            });
            this.reactions.set(key, sent.event_id);
            return;
        }
        const reactionEventId = this.reactions.get(key);
        if (!reactionEventId)
            throw new MatrixError("缺少当前进程发送的 Matrix reaction 事件上下文", {
                code: "MATRIX_REACTION_CONTEXT_MISSING",
            });
        await client.redact(params.group_id.string, reactionEventId);
        this.reactions.delete(key);
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const data = materializeMatrixUpload(params);
        const uploaded = await this.requireClient(uin).uploadMedia(data, params.name);
        return {
            file_id: this.createId(uploaded.content_uri),
            file_name: params.name,
            file_size: data.byteLength,
            url: uploaded.content_uri,
        };
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return MATRIX_PLATFORM_ACTIONS.has(action)
            ? executeMatrixPlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return MATRIX_PLATFORM_ACTIONS.has(action);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots Matrix Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Matrix Client-Server API",
            version: "v1.19",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        const online = account?.status === AccountStatus.Online;
        return {
            online,
            good: online,
            bots: account ? [{ self: this.createId(account.client.userId), online }] : [],
        };
    }

    async canSendImage(): Promise<boolean> {
        return true;
    }
    async canSendRecord(): Promise<boolean> {
        return true;
    }

    createAccount(config: Account.Config<"matrix">): Account<"matrix", MatrixClient> {
        const client = new MatrixClient(normalizeMatrixConfig(config), {
            reportError: error => this.logger.error("Matrix 接收管线异常", error),
        });
        const account = new Account<"matrix", MatrixClient>(this, client, config);
        client.on("event", (event: MatrixEventEnvelope) =>
            account.dispatchManyAwaited(
                projectMatrixEvent(event, {
                    botId: this.createId(client.userId),
                    botUserId: client.userId,
                    createId: value => this.createId(value),
                }),
            ),
        );
        if (client.receiveMode === "appservice") {
            this.appserviceHost.mount(account.account_id, client, account.path);
        }
        account.on("start", async (signal: AbortSignal) => {
            try {
                const identity = await client.start(signal);
                account.status = AccountStatus.Online;
                account.nickname = identity.user_id;
                this.logger.info(`Matrix Bot ${identity.user_id} 已就绪（${client.receiveMode}）`);
            } catch (error) {
                account.status = AccountStatus.OffLine;
                this.logger.error(`启动 Matrix Bot ${config.account_id} 失败`, error);
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

    private requireClient(uin: string): MatrixClient {
        const client = this.getAccount(uin)?.client;
        if (!client)
            throw new MatrixError(`Matrix 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        return client;
    }

    private requireRoom(client: MatrixClient, eventId: string, explicit?: string): string {
        const roomId = explicit || client.resolveEventRoom(eventId);
        if (!roomId)
            throw new MatrixError("Matrix 消息动作需要 scene_id 或已观察到的 event_id 上下文", {
                code: "MATRIX_ROOM_CONTEXT_MISSING",
            });
        return roomId;
    }

    private async loadGroupInfo(client: MatrixClient, roomId: string): Promise<Adapter.GroupInfo> {
        const summary = parseRoomSummary(
            await client.call(
                "GET",
                `/_matrix/client/v1/room_summary/${encodeURIComponent(roomId)}`,
            ),
            roomId,
        );
        return {
            group_id: this.createId(roomId),
            group_name: summary.name || summary.canonical_alias || roomId,
            member_count: summary.joined_member_count,
            description: summary.topic,
        };
    }

    private async loadMembers(client: MatrixClient, roomId: string): Promise<MatrixRoomMember[]> {
        const [members, state] = await Promise.all([
            client.call("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`),
            client.call("GET", `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`),
        ]);
        return applyPowerLevels(parseMembers(members), parseRoomState(state));
    }

    private toMember(groupId: CommonTypes.Id, member: MatrixRoomMember): Adapter.GroupMemberInfo {
        return {
            group_id: groupId,
            user_id: this.createId(member.user_id),
            user_name: member.displayname || member.user_id,
            card: member.displayname,
            role: member.role || "member",
            level: member.power_level,
        };
    }

    private toMessage(event: MatrixRawEvent, roomId: string): Adapter.MessageInfo {
        const sender = event.sender || "@unknown:matrix";
        return {
            message_id: this.createId(event.event_id || `event:${event.origin_server_ts || 0}`),
            time: Math.floor((event.origin_server_ts || 0) / 1000),
            sender: {
                scene_type: "group",
                sender_id: this.createId(sender),
                scene_id: this.createId(roomId),
                sender_name: sender,
                scene_name: roomId,
            },
            message:
                event.type === "m.sticker"
                    ? [
                          {
                              type: "image",
                              data: {
                                  url: event.content.url,
                                  file: event.content.url,
                                  sticker: true,
                              },
                          },
                      ]
                    : projectMatrixMessageContent(event.content),
        };
    }

    private putState(
        client: MatrixClient,
        roomId: string,
        type: string,
        body: Record<string, unknown>,
    ): Promise<unknown> {
        return client.call(
            "PUT",
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state/${encodeURIComponent(type)}/`,
            { body },
        );
    }

    private roomMemberCall(
        client: MatrixClient,
        roomId: string,
        action: string,
        userId: string,
    ): Promise<unknown> {
        return client.call(
            "POST",
            `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/${action}`,
            { body: { user_id: userId } },
        );
    }
}
