import type { CommonTypes } from "onebots";
import type { ToolEntry } from "./tool-registry.js";

/** 频道、文件和系统领域工具；与消息及社群工具保持同一个 Adapter seam。 */
export const AUXILIARY_TOOL_REGISTRY: Record<string, ToolEntry> = {
    get_guild_list: {
        description: "获取已加入的频道（Guild）列表",
        inputSchema: { type: "object", properties: {} },
        async handler(adapter, uin) {
            const list = await adapter.getGuildList(uin);
            return list.map(g => ({ guild_id: g.guild_id.string, guild_name: g.guild_name }));
        },
    },

    get_guild_info: {
        description: "获取频道（Guild）详情",
        inputSchema: {
            type: "object",
            properties: { guild_id: { type: "string", description: "频道 ID" } },
            required: ["guild_id"],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getGuildInfo(uin, {
                guild_id: adapter.resolveId(String(args.guild_id)),
            });
            return { guild_id: info.guild_id.string, guild_name: info.guild_name };
        },
    },

    get_channel_list: {
        description: "获取频道（Guild）下的子频道列表",
        inputSchema: {
            type: "object",
            properties: { guild_id: { type: "string", description: "频道 ID" } },
            required: ["guild_id"],
        },
        async handler(adapter, uin, args) {
            const list = await adapter.getChannelList(uin, {
                guild_id: adapter.resolveId(String(args.guild_id)),
            });
            return list.map(c => ({
                channel_id: c.channel_id.string,
                channel_name: c.channel_name,
                channel_type: c.channel_type,
            }));
        },
    },

    get_channel_info: {
        description: "获取子频道详情",
        inputSchema: {
            type: "object",
            properties: { channel_id: { type: "string", description: "子频道 ID" } },
            required: ["channel_id"],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getChannelInfo(uin, {
                channel_id: adapter.resolveId(String(args.channel_id)),
            });
            return {
                channel_id: info.channel_id.string,
                channel_name: info.channel_name,
                channel_type: info.channel_type,
            };
        },
    },

    get_guild_member_info: {
        description: "获取频道成员信息",
        inputSchema: {
            type: "object",
            properties: {
                guild_id: { type: "string", description: "频道 ID" },
                user_id: { type: "string", description: "用户 ID" },
            },
            required: ["guild_id", "user_id"],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getGuildMemberInfo(uin, {
                guild_id: adapter.resolveId(String(args.guild_id)),
                user_id: adapter.resolveId(String(args.user_id)),
            });
            return {
                user_id: info.user_id.string,
                user_name: info.user_name,
                nickname: info.nickname,
                role: info.role,
            };
        },
    },

    get_channel_member_list: {
        description: "获取子频道成员列表",
        inputSchema: {
            type: "object",
            properties: { channel_id: { type: "string", description: "子频道 ID" } },
            required: ["channel_id"],
        },
        async handler(adapter, uin, args) {
            const list = await adapter.getChannelMemberList(uin, {
                channel_id: adapter.resolveId(String(args.channel_id)),
            });
            return list.map(member => ({
                user_id: member.user_id.string,
                user_name: member.user_name,
                role: member.role,
            }));
        },
    },

    upload_file: {
        description: "上传文件（图片/视频/语音/文件）",
        inputSchema: {
            type: "object",
            properties: {
                scene_type: { type: "string", description: "场景类型", enum: ["group", "private"] },
                scene_id: { type: "string", description: "场景 ID" },
                name: { type: "string", description: "文件名" },
                url: { type: "string", description: "文件 URL" },
            },
            required: ["scene_type", "scene_id", "name", "url"],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.uploadFile(uin, {
                scene_type: String(args.scene_type) as CommonTypes.Scene,
                scene_id: adapter.resolveId(String(args.scene_id)),
                name: String(args.name),
                url: String(args.url),
            });
            return { file_id: info.file_id.string, file_name: info.file_name, url: info.url };
        },
    },

    get_supported_actions: {
        description: "获取当前平台支持的 API 列表",
        inputSchema: { type: "object", properties: {} },
        async handler(adapter, uin) {
            return adapter.getSupportedActions(uin);
        },
    },

    get_status: {
        description: "获取当前机器人运行状态",
        inputSchema: { type: "object", properties: {} },
        async handler(adapter, uin) {
            const status = await adapter.getStatus(uin);
            return { online: status.online, good: status.good };
        },
    },

    get_version: {
        description: "获取实现版本信息",
        inputSchema: { type: "object", properties: {} },
        async handler(adapter, uin) {
            return adapter.getVersion(uin);
        },
    },
};
