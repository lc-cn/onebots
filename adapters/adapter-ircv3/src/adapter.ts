import { randomUUID } from "node:crypto";
import {
    Account,
    AccountStatus,
    Adapter,
    BaseApp,
    readPackageVersion,
    type AdapterCapabilityManifest,
} from "onebots";
import { describeIrcv3Capabilities, ircv3Capabilities } from "./capabilities.js";
import { Ircv3Client } from "./client.js";
import { Ircv3Error } from "./errors.js";
import { projectIrcv3Event } from "./events.js";
import { compileIrcv3Message, projectIrcv3MessageSegments, splitIrcv3Text } from "./messages.js";
import { executeIrcv3PlatformAction, IRCV3_PLATFORM_ACTIONS } from "./platform-actions.js";
import type { Ircv3Config, Ircv3Message } from "./types.js";

export class Ircv3Adapter extends Adapter<Ircv3Client, "ircv3"> {
    constructor(app: BaseApp) {
        super(app, "ircv3", ircv3Capabilities);
        this.icon = "https://ircv3.net/favicon.ico";
    }

    describeCapabilities(uin?: string): AdapterCapabilityManifest {
        const client = uin ? this.getAccount(uin)?.client : undefined;
        return client ? describeIrcv3Capabilities(client.config, client) : ircv3Capabilities;
    }

    async sendMessage(
        uin: string,
        params: Adapter.SendMessageParams,
    ): Promise<Adapter.SendMessageResult> {
        if (!["channel", "group", "direct", "private"].includes(params.scene_type)) {
            throw new Ircv3Error(`IRC 不支持 scene ${params.scene_type}`, {
                code: "IRCV3_UNSUPPORTED_SCENE",
            });
        }
        const client = this.requireClient(uin);
        const compiled = compileIrcv3Message(params.message);
        const lines = splitIrcv3Text("PRIVMSG", params.scene_id.string, compiled.text);
        let receipt: string | undefined;
        for (let index = 0; index < lines.length; index += 1) {
            const tags =
                index === 0 && compiled.replyMessageId && client.supportsCapability("message-tags")
                    ? { "+reply": compiled.replyMessageId }
                    : undefined;
            receipt =
                (await client.sendMessageWithReceipt(params.scene_id.string, lines[index], tags)) ||
                receipt;
        }
        return { message_id: this.createId(receipt || `local:${randomUUID()}`) };
    }

    async getMessageHistory(
        uin: string,
        params: Adapter.GetMessageHistoryParams,
    ): Promise<Adapter.MessageInfo[]> {
        if (params.offset !== undefined)
            throw Ircv3Error.invalid("IRC CHATHISTORY 不支持数字 offset");
        const messages = await this.requireClient(uin).history(
            params.scene_id.string,
            params.limit || 50,
            params.start_message_id?.string,
        );
        return messages
            .filter(message => message.command === "PRIVMSG" || message.command === "NOTICE")
            .map(message => this.messageInfo(params.scene_type, params.scene_id.string, message));
    }

    async getLoginInfo(uin: string): Promise<Adapter.UserInfo> {
        const snapshot = this.requireClient(uin).snapshot;
        return {
            user_id: this.createId(snapshot.account || snapshot.nickname),
            user_name: snapshot.nickname,
        };
    }

    async getUserInfo(uin: string, params: Adapter.GetUserInfoParams): Promise<Adapter.UserInfo> {
        return this.whoisUser(this.requireClient(uin), params.user_id.string);
    }

    async createUserChannel(
        _uin: string,
        params: Adapter.CreateUserChannelParams,
    ): Promise<Adapter.ChannelInfo> {
        return {
            channel_id: this.createId(params.user_id.string),
            channel_name: params.user_id.string,
        };
    }

    async setNickname(uin: string, params: Adapter.SetNicknameParams): Promise<void> {
        await this.requireClient(uin).setNickname(params.nickname);
    }

    async getGroupList(uin: string): Promise<Adapter.GroupInfo[]> {
        const client = this.requireClient(uin);
        const channels = new Set([
            ...client.config.channels.map(channel => channel.name),
            ...client.snapshot.joinedChannels,
        ]);
        return [...channels].map(channel => this.groupInfo(channel));
    }

    async getGroupInfo(
        _uin: string,
        params: Adapter.GetGroupInfoParams,
    ): Promise<Adapter.GroupInfo> {
        return this.groupInfo(params.group_id.string);
    }

    async leaveGroup(uin: string, params: Adapter.LeaveGroupParams): Promise<void> {
        if (params.is_dismiss) throw Ircv3Error.invalid("IRC channel 不支持解散语义");
        await this.requireClient(uin).part(params.group_id.string);
    }

    async getGroupMemberList(
        uin: string,
        params: Adapter.GetGroupMemberListParams,
    ): Promise<Adapter.GroupMemberInfo[]> {
        const messages = await this.requireClient(uin).names(params.group_id.string);
        const prefixes = parsePrefixSymbols(this.requireClient(uin).snapshot.isupport.PREFIX);
        const names = messages
            .filter(message => message.command === "353")
            .flatMap(message => (message.params.at(-1) || "").split(" ").filter(Boolean));
        return names.map(name => this.memberInfo(params.group_id.string, name, prefixes));
    }

    async getGroupMemberInfo(
        uin: string,
        params: Adapter.GetGroupMemberInfoParams,
    ): Promise<Adapter.GroupMemberInfo> {
        const members = await this.getGroupMemberList(uin, {
            group_id: params.group_id,
            no_cache: params.no_cache,
        });
        const client = this.requireClient(uin);
        const member = members.find(item =>
            client.identifiersEqual(item.user_name, params.user_id.string),
        );
        if (!member) {
            throw new Ircv3Error(
                `IRC channel ${params.group_id.string} 中不存在成员 ${params.user_id.string}`,
                { code: "IRCV3_MEMBER_NOT_FOUND", status: 404 },
            );
        }
        return member;
    }

    async kickGroupMember(uin: string, params: Adapter.KickGroupMemberParams): Promise<void> {
        if (params.reject_add_request)
            throw Ircv3Error.invalid("IRC KICK 不包含永久拒绝后续加入语义");
        await this.requireClient(uin).call("KICK", [params.group_id.string, params.user_id.string]);
    }

    async inviteGroupMember(uin: string, params: Adapter.InviteGroupMemberParams): Promise<void> {
        await this.requireClient(uin).call("INVITE", [
            params.user_id.string,
            params.group_id.string,
        ]);
    }

    async setGroupAdmin(uin: string, params: Adapter.SetGroupAdminParams): Promise<void> {
        await this.requireClient(uin).call("MODE", [
            params.group_id.string,
            params.enable ? "+o" : "-o",
            params.user_id.string,
        ]);
    }

    async handleGroupRequest(uin: string, params: Adapter.HandleGroupRequestParams): Promise<void> {
        if (params.type !== "invitation" || !params.group_id)
            throw Ircv3Error.invalid("IRC 只能处理发送给当前机器人的 channel INVITE");
        if (params.block) throw Ircv3Error.invalid("IRC 拒绝 INVITE 不支持 block 语义");
        if (params.approve) await this.requireClient(uin).join(params.group_id.string);
    }

    async sendGroupAnnouncement(
        uin: string,
        params: Adapter.SendGroupAnnouncementParams,
    ): Promise<void> {
        const client = this.requireClient(uin);
        for (const line of splitIrcv3Text("NOTICE", params.group_id.string, params.content)) {
            await client.sendNotice(params.group_id.string, line);
        }
    }

    async getChannelInfo(
        _uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        return {
            channel_id: this.createId(params.channel_id.string),
            channel_name: params.channel_id.string,
        };
    }

    async getChannelList(uin: string): Promise<Adapter.ChannelInfo[]> {
        return (await this.getGroupList(uin)).map(group => ({
            channel_id: group.group_id,
            channel_name: group.group_name,
        }));
    }

    async canSendImage(): Promise<boolean> {
        return false;
    }

    async canSendRecord(): Promise<boolean> {
        return false;
    }

    executePlatformAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return IRCV3_PLATFORM_ACTIONS.has(action as never)
            ? executeIrcv3PlatformAction(this.requireClient(uin), action, params)
            : super.executePlatformAction(uin, action, params);
    }

    isPlatformActionImplemented(action: string): boolean {
        return IRCV3_PLATFORM_ACTIONS.has(action as never);
    }

    async getVersion(): Promise<Adapter.VersionInfo> {
        return {
            app_name: "onebots IRCv3 Adapter",
            app_version: await readPackageVersion(import.meta.url),
            impl: "Modern IRC + IRCv3 CAP 302",
            version: "IRCv3 stable specifications",
        };
    }

    async getStatus(uin: string): Promise<Adapter.StatusInfo> {
        const account = this.getAccount(uin);
        if (!account) return { good: false };
        const online = account.status === AccountStatus.Online;
        const transportGood =
            account.client.receiveMode === "manual" || account.client.isRegistered;
        return {
            online,
            good: online && transportGood,
            bots: [
                {
                    self: this.createId(
                        account.client.snapshot.account || account.client.snapshot.nickname,
                    ),
                    online,
                },
            ],
        };
    }

    createAccount(config: Account.Config<"ircv3">): Account<"ircv3", Ircv3Client> {
        const client = new Ircv3Client(config as Ircv3Config, {
            reportError: error => this.logger.error("IRCv3 Client 异常", error),
        });
        const account = new Account<"ircv3", Ircv3Client>(this, client, config);
        client.on("event", delivery =>
            account.dispatchManyAwaited(
                projectIrcv3Event(delivery, {
                    botId: this.createId(client.snapshot.account || client.snapshot.nickname),
                    createId: value => this.createId(value),
                    snapshot: client.snapshot,
                }),
            ),
        );
        client.on("error", error => this.logger.error("IRCv3 事件管线异常", error));
        account.on("start", async (signal: AbortSignal) => {
            await client.start(signal);
            account.status = AccountStatus.Online;
            account.nickname = client.snapshot.nickname;
            this.logger.info(`IRCv3 ${account.account_id} 已就绪（${client.receiveMode}）`);
        });
        account.on("stop", async () => {
            await client.stop();
            account.status = AccountStatus.OffLine;
        });
        client.on("disconnected", () => {
            if (client.receiveMode === "connection") account.status = AccountStatus.Pending;
        });
        client.on("connected", () => {
            account.status = AccountStatus.Online;
            account.nickname = client.snapshot.nickname;
        });
        return account;
    }

    private groupInfo(channel: string): Adapter.GroupInfo {
        return { group_id: this.createId(channel), group_name: channel };
    }

    private requireClient(uin: string): Ircv3Client {
        const client = this.getAccount(uin)?.client;
        if (!client) {
            throw new Ircv3Error(`IRCv3 账号 ${uin} 不存在`, {
                code: "ACCOUNT_NOT_FOUND",
                status: 404,
            });
        }
        return client;
    }

    private async whoisUser(client: Ircv3Client, nickname: string): Promise<Adapter.UserInfo> {
        const messages = await client.whois(nickname);
        const user = messages.find(message => message.command === "311");
        const account = messages.find(message => message.command === "330")?.params[2];
        const actualNick = user?.params[1] || nickname;
        return {
            user_id: this.createId(account || actualNick),
            user_name: actualNick,
            user_displayname: user?.params[5],
            area: user ? `${user.params[2] || ""}@${user.params[3] || ""}` : undefined,
        };
    }

    private memberInfo(
        channel: string,
        rawName: string,
        prefixes: ReadonlySet<string>,
    ): Adapter.GroupMemberInfo {
        let name = rawName;
        let admin = false;
        while (prefixes.has(name[0])) {
            admin ||= ["~", "&", "@", "%"].includes(name[0]);
            name = name.slice(1);
        }
        const hostSeparator = name.indexOf("!");
        if (hostSeparator >= 0) name = name.slice(0, hostSeparator);
        return {
            group_id: this.createId(channel),
            user_id: this.createId(name),
            user_name: name,
            role: admin ? "admin" : "member",
        };
    }

    private messageInfo(
        sceneType: Adapter.GetMessageHistoryParams["scene_type"],
        sceneId: string,
        message: Ircv3Message,
    ): Adapter.MessageInfo {
        const nick = message.source?.nick || "unknown";
        const id = typeof message.tags.msgid === "string" ? message.tags.msgid : message.raw;
        const parsedTime =
            typeof message.tags.time === "string" ? Date.parse(message.tags.time) : Number.NaN;
        const account =
            typeof message.tags.account === "string" && message.tags.account !== "*"
                ? message.tags.account
                : nick;
        return {
            message_id: this.createId(id),
            time: Number.isFinite(parsedTime) ? parsedTime : Date.now(),
            sender: {
                scene_type: sceneType,
                sender_id: this.createId(account),
                scene_id: this.createId(sceneId),
                sender_name: nick,
                scene_name: sceneId,
            },
            message: projectIrcv3MessageSegments(message.params[1] || "", message.tags),
        };
    }
}

function parsePrefixSymbols(value: string | null | undefined): ReadonlySet<string> {
    const match = /^\([^)]*\)(.+)$/u.exec(value || "");
    return new Set([...(match?.[1] || "~&@%+")]);
}
