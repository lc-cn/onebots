import type { Account, Adapter, CommonTypes } from "onebots";
import { SatoriDirectoryActions } from "./actions-directory.js";
import { SatoriMessageActions } from "./actions-message.js";
import type { SatoriChannelRouteRegistry } from "./channel-routes.js";

/** Satori 资源动作目录；仅暴露规范 resource.method 名称。 */
export class SatoriActionService {
    private readonly messages: SatoriMessageActions;
    private readonly directory: SatoriDirectoryActions;

    constructor(
        private readonly adapter: Adapter,
        private readonly account: Account,
        serializeMessage: (segments: CommonTypes.Segment[]) => string,
        channelRoutes: SatoriChannelRouteRegistry,
    ) {
        this.messages = new SatoriMessageActions(adapter, account, serializeMessage, channelRoutes);
        this.directory = new SatoriDirectoryActions(adapter, account, channelRoutes);
    }

    async execute(action: string, params: Record<string, unknown> = {}): Promise<unknown> {
        switch (action) {
            case "message.create":
                return this.messages.createMessage(params);
            case "message.get":
                return this.messages.getMessage(params);
            case "message.delete":
                return this.messages.deleteMessage(params);
            case "message.update":
                return this.messages.updateMessage(params);
            case "message.list":
                return this.messages.getMessageList(params);
            case "reaction.create":
                return this.messages.updateReaction(params, true);
            case "reaction.delete":
                return this.messages.updateReaction(params, false);
            case "channel.get":
                return this.messages.getChannel(params);
            case "channel.list":
                return this.messages.getChannelList(params);
            case "channel.create":
                return this.messages.createChannel(params);
            case "channel.update":
                return this.messages.updateChannel(params);
            case "channel.delete":
                return this.messages.deleteChannel(params);
            case "guild.get":
                return this.directory.getGuild(params);
            case "guild.list":
                return this.directory.getGuildList(params);
            case "guild.member.get":
                return this.directory.getGuildMember(params);
            case "guild.member.list":
                return this.directory.getGuildMemberList(params);
            case "guild.member.kick":
                return this.directory.kickGuildMember(params);
            case "guild.member.mute":
                return this.directory.muteGuildMember(params);
            case "user.get":
                return this.directory.getUser(params);
            case "user.channel.create":
                return this.directory.createDirectChannel(params);
            case "friend.list":
                return this.directory.getFriendList(params);
            case "friend.delete":
                return this.directory.deleteFriend(params);
            case "friend.approve":
                return this.directory.approveFriend(params);
            case "guild.approve":
                return this.directory.approveGuild(params);
            case "guild.member.approve":
                return this.directory.approveGuildMember(params);
            case "login.get":
                return this.directory.getLogin();
            default:
                if (
                    typeof this.adapter.describeCapabilities === "function" &&
                    this.adapter.describeCapabilities(this.account.account_id).actions[action]
                ) {
                    return this.adapter.callAction(this.account.account_id, action, params);
                }
                throw new Error(`Unknown action: ${action}`);
        }
    }

    getLogin() {
        return this.directory.getLogin();
    }
}
