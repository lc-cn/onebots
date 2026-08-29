import type { GfsDirStat, GfsFileStat } from "@icqqjs/icqq/lib/gfs";
import { Adapter, type CommonTypes } from "onebots";
import { ICQQGroupActions } from "./group-actions.js";
import { materializeICQQUpload } from "./media.js";

/** QQ 频道与私聊/群文件动作。 */
export abstract class ICQQGuildFileActions extends ICQQGroupActions {
    async getGuildList(uin: string): Promise<Adapter.GuildInfo[]> {
        return this.requireNativeClient(uin)
            .getGuildList()
            .map(guild => ({
                guild_id: this.createId(guild.guild_id),
                guild_name: guild.guild_name,
            }));
    }

    async getGuildInfo(
        uin: string,
        params: Adapter.GetGuildInfoParams,
    ): Promise<Adapter.GuildInfo> {
        const guild = this.requireNativeClient(uin).getGuildInfo(params.guild_id.string);
        if (!guild) throw new Error(`Guild ${params.guild_id.string} not found`);
        return {
            guild_id: this.createId(guild.guild_id),
            guild_name: guild.guild_name,
        };
    }

    async getGuildMemberInfo(
        uin: string,
        params: Adapter.GetGuildMemberInfoParams,
    ): Promise<Adapter.GuildMemberInfo> {
        const members = await this.requireNativeClient(uin)
            .pickGuild(params.guild_id.string)
            .getMemberList();
        const member = members.find(item => item.tiny_id === params.user_id.string);
        if (!member) throw new Error(`Guild member ${params.user_id.string} not found`);
        return {
            guild_id: params.guild_id,
            user_id: this.createId(member.tiny_id),
            user_name: member.nickname,
            nickname: member.card || member.nickname,
            role: String(member.role),
        };
    }

    async getGuildMemberList(
        uin: string,
        params: Adapter.GetGuildMemberListParams,
    ): Promise<Adapter.GuildMemberInfo[]> {
        const members = await this.requireNativeClient(uin)
            .pickGuild(params.guild_id.string)
            .getMemberList();
        return members.map(member => ({
            guild_id: params.guild_id,
            user_id: this.createId(member.tiny_id),
            user_name: member.nickname,
            nickname: member.card || member.nickname,
            role: String(member.role),
        }));
    }

    async getChannelList(
        uin: string,
        params?: Adapter.GetChannelListParams,
    ): Promise<Adapter.ChannelInfo[]> {
        if (!params) throw new TypeError("获取 ICQQ 子频道列表需要 guild_id");
        return this.requireNativeClient(uin)
            .getChannelList(params.guild_id.string)
            .map(channel => ({
                channel_id: this.createId(channel.channel_id),
                channel_name: channel.channel_name,
                channel_type: channel.channel_type,
            }));
    }

    async getChannelInfo(
        uin: string,
        params: Adapter.GetChannelInfoParams,
    ): Promise<Adapter.ChannelInfo> {
        const client = this.requireNativeClient(uin);
        const guildIds = params.guild_id ? [params.guild_id.string] : [...client.guilds.keys()];
        for (const guildId of guildIds) {
            const channel = client.getChannelInfo(guildId, params.channel_id.string);
            if (channel) {
                return {
                    channel_id: this.createId(channel.channel_id),
                    channel_name: channel.channel_name,
                    channel_type: channel.channel_type,
                };
            }
        }
        throw new Error(`Channel ${params.channel_id.string} not found`);
    }

    async uploadFile(uin: string, params: Adapter.UploadFileParams): Promise<Adapter.FileInfo> {
        const client = this.requireNativeClient(uin);
        const source = await materializeICQQUpload(params);
        if (params.scene_type === "group") {
            const file = await client
                .acquireGfs(this.numericId(params.scene_id.string, "scene_id"))
                .upload(source, params.folder_id?.string, params.name);
            return this.convertFileInfo(file);
        }
        if (params.scene_type === "private" || params.scene_type === "direct") {
            const file = await client
                .pickFriend(this.numericId(params.scene_id.string, "scene_id"))
                .uploadFile(source, params.name);
            return {
                file_id: this.createId(file.fid ?? params.name),
                file_name: file.name ?? params.name,
                file_size: file.size,
                url: file.url,
            };
        }
        throw new TypeError(`ICQQ 不支持在 ${params.scene_type} 场景上传文件`);
    }

    async deleteFile(uin: string, params: Adapter.DeleteFileParams): Promise<void> {
        if (!params.scene_id) throw new TypeError("删除 ICQQ 文件需要 scene_id");
        const client = this.requireNativeClient(uin);
        if (params.scene_type === "group") {
            await client
                .acquireGfs(this.numericId(params.scene_id.string, "scene_id"))
                .rm(params.file_id.string);
            return;
        }
        if (params.scene_type === "private" || params.scene_type === "direct") {
            const accepted = await client
                .pickFriend(this.numericId(params.scene_id.string, "scene_id"))
                .recallFile(params.file_id.string);
            this.assertNativeAccepted(accepted, "撤回私聊文件");
            return;
        }
        throw new TypeError("删除 ICQQ 文件需要 private、direct 或 group 场景");
    }

    async getGroupFiles(
        uin: string,
        params: Adapter.GetGroupFilesParams,
    ): Promise<Adapter.GroupFilesResult> {
        const entries = await this.requireNativeClient(uin)
            .acquireGfs(this.numericId(params.group_id.string, "group_id"))
            .dir(params.parent_folder_id?.string ?? "/");
        return {
            files: entries
                .filter(this.isGfsFile)
                .map(file => this.convertFileInfo(file, params.group_id)),
            folders: entries.filter(this.isGfsDirectory).map(folder => ({
                folder_id: this.createId(folder.fid),
                folder_name: folder.name,
                group_id: params.group_id,
                parent_folder_id: this.createId(folder.pid),
                created_time: folder.create_time,
                last_modified_time: folder.modify_time,
                creator_id: this.createId(folder.user_id),
                file_count: folder.file_count,
            })),
        };
    }

    async createGroupFolder(
        uin: string,
        params: Adapter.CreateGroupFolderParams,
    ): Promise<Adapter.FolderInfo> {
        if (params.parent_folder_id && params.parent_folder_id.string !== "/") {
            throw new TypeError("ICQQ 仅支持在群文件根目录创建文件夹");
        }
        const folder = await this.requireNativeClient(uin)
            .acquireGfs(this.numericId(params.group_id.string, "group_id"))
            .mkdir(params.folder_name);
        return {
            folder_id: this.createId(folder.fid),
            folder_name: folder.name,
        };
    }

    async getFileDownloadUrl(
        uin: string,
        params: Adapter.GetFileDownloadUrlParams,
    ): Promise<string> {
        const client = this.requireNativeClient(uin);
        if (params.scene_type === "group") {
            const file = await client
                .acquireGfs(this.numericId(params.scene_id.string, "scene_id"))
                .download(params.file_id.string);
            return file.url;
        }
        if (params.scene_type === "private" || params.scene_type === "direct") {
            return client
                .pickUser(this.numericId(params.scene_id.string, "scene_id"))
                .getFileUrl(params.file_id.string);
        }
        throw new TypeError(`ICQQ 不支持获取 ${params.scene_type} 场景的文件地址`);
    }

    async moveGroupFile(uin: string, params: Adapter.MoveGroupFileParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(this.numericId(params.group_id.string, "group_id"))
            .mv(params.file_id.string, params.target_folder_id.string);
    }

    async renameGroupFile(uin: string, params: Adapter.RenameGroupFileParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(this.numericId(params.group_id.string, "group_id"))
            .rename(params.file_id.string, params.new_name);
    }

    async renameGroupFolder(uin: string, params: Adapter.RenameGroupFolderParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(this.numericId(params.group_id.string, "group_id"))
            .rename(params.folder_id.string, params.new_name);
    }

    async deleteGroupFolder(uin: string, params: Adapter.DeleteGroupFolderParams): Promise<void> {
        await this.requireNativeClient(uin)
            .acquireGfs(this.numericId(params.group_id.string, "group_id"))
            .rm(params.folder_id.string);
    }

    async canSendImage(uin: string): Promise<boolean> {
        this.requireNativeClient(uin);
        return true;
    }

    async canSendRecord(uin: string): Promise<boolean> {
        this.requireNativeClient(uin);
        return true;
    }

    private convertFileInfo(file: GfsFileStat, groupId?: CommonTypes.Id): Adapter.FileInfo {
        return {
            file_id: this.createId(file.fid),
            file_name: file.name,
            file_size: file.size,
            group_id: groupId,
            parent_folder_id: this.createId(file.pid),
            uploaded_time: file.create_time,
            expire_time: file.duration > 0 ? file.create_time + file.duration : undefined,
            uploader_id: this.createId(file.user_id),
            downloaded_times: file.download_times,
        };
    }

    private isGfsFile(entry: GfsFileStat | GfsDirStat): entry is GfsFileStat {
        return !entry.is_dir;
    }

    private isGfsDirectory(entry: GfsFileStat | GfsDirStat): entry is GfsDirStat {
        return entry.is_dir;
    }
}
