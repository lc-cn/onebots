import type { Adapter } from 'onebots';
import type { McpTool, McpToolCallResult } from './types.js';

interface ToolEntry {
    description: string;
    inputSchema: McpTool['inputSchema'];
    handler: (adapter: Adapter, uin: string, args: Record<string, unknown>) => Promise<unknown>;
}

function toBool(v: unknown): boolean {
    return v === true || v === 'true' || v === '1';
}

const TOOL_REGISTRY: Record<string, ToolEntry> = {
    // ---- 消息 ----
    send_message: {
        description: '发送消息到指定场景（群聊/私聊/频道/频道私信）',
        inputSchema: {
            type: 'object',
            properties: {
                scene_type: { type: 'string', description: '消息场景类型', enum: ['group', 'private', 'channel', 'direct'] },
                scene_id: { type: 'string', description: '目标 ID' },
                message: { type: 'string', description: '消息内容（纯文本）' },
            },
            required: ['scene_type', 'scene_id', 'message'],
        },
        async handler(adapter, uin, args) {
            const result = await adapter.sendMessage(uin, {
                scene_type: String(args.scene_type) as any,
                scene_id: adapter.resolveId(String(args.scene_id)),
                message: [{ type: 'text', data: { text: String(args.message ?? '') } }],
            });
            return { message_id: result.message_id.string };
        },
    },

    delete_message: {
        description: '撤回/删除一条消息',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息 ID' },
                scene_type: { type: 'string', description: '消息场景类型', enum: ['group', 'private', 'channel', 'direct'] },
                scene_id: { type: 'string', description: '场景 ID' },
            },
            required: ['message_id'],
        },
        async handler(adapter, uin, args) {
            await adapter.deleteMessage(uin, {
                message_id: adapter.resolveId(String(args.message_id)),
                scene_type: args.scene_type as any,
                scene_id: args.scene_id ? adapter.resolveId(String(args.scene_id)) : undefined,
            });
            return { ok: true };
        },
    },

    get_message: {
        description: '获取一条消息的详情',
        inputSchema: {
            type: 'object',
            properties: {
                message_id: { type: 'string', description: '消息 ID' },
                scene_type: { type: 'string', description: '消息场景类型' },
                scene_id: { type: 'string', description: '场景 ID' },
            },
            required: ['message_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getMessage(uin, {
                message_id: adapter.resolveId(String(args.message_id)),
                scene_type: args.scene_type as any,
                scene_id: args.scene_id ? adapter.resolveId(String(args.scene_id)) : undefined,
            });
            return { message_id: info.message_id.string, time: info.time, message: info.message };
        },
    },

    // ---- 用户 / 账号 ----
    get_login_info: {
        description: '获取当前机器人账号信息（ID、昵称、头像）',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            const info = await adapter.getLoginInfo(uin);
            return { user_id: info.user_id.string, user_name: info.user_name, avatar: info.avatar };
        },
    },

    get_user_info: {
        description: '获取指定用户的信息',
        inputSchema: {
            type: 'object',
            properties: { user_id: { type: 'string', description: '用户 ID' } },
            required: ['user_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getUserInfo(uin, { user_id: adapter.resolveId(String(args.user_id)) });
            return { user_id: info.user_id.string, user_name: info.user_name, avatar: info.avatar };
        },
    },

    // ---- 好友 ----
    get_friend_list: {
        description: '获取好友列表',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            const list = await adapter.getFriendList(uin);
            return list.map(f => ({ user_id: f.user_id.string, user_name: f.user_name, remark: f.remark }));
        },
    },

    get_friend_info: {
        description: '获取指定好友的信息',
        inputSchema: {
            type: 'object',
            properties: { user_id: { type: 'string', description: '好友用户 ID' } },
            required: ['user_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getFriendInfo(uin, { user_id: adapter.resolveId(String(args.user_id)) });
            return { user_id: info.user_id.string, user_name: info.user_name, remark: info.remark };
        },
    },

    handle_friend_request: {
        description: '处理好友请求（同意/拒绝）',
        inputSchema: {
            type: 'object',
            properties: {
                flag: { type: 'string', description: '请求标识' },
                approve: { type: 'string', description: '是否同意', enum: ['true', 'false'] },
                remark: { type: 'string', description: '备注名（同意时可选）' },
            },
            required: ['flag', 'approve'],
        },
        async handler(adapter, uin, args) {
            await adapter.handleFriendRequest(uin, {
                flag: String(args.flag),
                approve: toBool(args.approve),
                remark: args.remark ? String(args.remark) : undefined,
            } as any);
            return { ok: true };
        },
    },

    delete_friend: {
        description: '删除好友',
        inputSchema: {
            type: 'object',
            properties: { user_id: { type: 'string', description: '好友用户 ID' } },
            required: ['user_id'],
        },
        async handler(adapter, uin, args) {
            await adapter.deleteFriend(uin, { user_id: adapter.resolveId(String(args.user_id)) });
            return { ok: true };
        },
    },

    // ---- 群组 ----
    get_group_list: {
        description: '获取群列表',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            const list = await adapter.getGroupList(uin);
            return list.map(g => ({ group_id: g.group_id.string, group_name: g.group_name, member_count: g.member_count }));
        },
    },

    get_group_info: {
        description: '获取指定群的信息',
        inputSchema: {
            type: 'object',
            properties: { group_id: { type: 'string', description: '群 ID' } },
            required: ['group_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getGroupInfo(uin, { group_id: adapter.resolveId(String(args.group_id)) });
            return { group_id: info.group_id.string, group_name: info.group_name, member_count: info.member_count };
        },
    },

    get_group_member_list: {
        description: '获取指定群的成员列表',
        inputSchema: {
            type: 'object',
            properties: { group_id: { type: 'string', description: '群 ID' } },
            required: ['group_id'],
        },
        async handler(adapter, uin, args) {
            const list = await adapter.getGroupMemberList(uin, { group_id: adapter.resolveId(String(args.group_id)) });
            return list.map(m => ({ user_id: m.user_id.string, user_name: m.user_name, card: m.card, role: m.role }));
        },
    },

    get_group_member_info: {
        description: '获取群成员详细信息',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                user_id: { type: 'string', description: '用户 ID' },
            },
            required: ['group_id', 'user_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getGroupMemberInfo(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                user_id: adapter.resolveId(String(args.user_id)),
            });
            return { user_id: info.user_id.string, user_name: info.user_name, card: info.card, role: info.role };
        },
    },

    set_group_name: {
        description: '设置群名称',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                group_name: { type: 'string', description: '新群名' },
            },
            required: ['group_id', 'group_name'],
        },
        async handler(adapter, uin, args) {
            await adapter.setGroupName(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                group_name: String(args.group_name),
            });
            return { ok: true };
        },
    },

    leave_group: {
        description: '退出群组',
        inputSchema: {
            type: 'object',
            properties: { group_id: { type: 'string', description: '群 ID' } },
            required: ['group_id'],
        },
        async handler(adapter, uin, args) {
            await adapter.leaveGroup(uin, { group_id: adapter.resolveId(String(args.group_id)) });
            return { ok: true };
        },
    },

    kick_group_member: {
        description: '踢出群成员',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                user_id: { type: 'string', description: '要踢出的用户 ID' },
                reject_add_request: { type: 'string', description: '是否拒绝再次加群', enum: ['true', 'false'] },
            },
            required: ['group_id', 'user_id'],
        },
        async handler(adapter, uin, args) {
            await adapter.kickGroupMember(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                user_id: adapter.resolveId(String(args.user_id)),
                reject_add_request: toBool(args.reject_add_request),
            });
            return { ok: true };
        },
    },

    mute_group_member: {
        description: '禁言群成员',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                user_id: { type: 'string', description: '要禁言的用户 ID' },
                duration: { type: 'string', description: '禁言时长（秒），0 为解除禁言' },
            },
            required: ['group_id', 'user_id'],
        },
        async handler(adapter, uin, args) {
            await adapter.muteGroupMember(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                user_id: adapter.resolveId(String(args.user_id)),
                duration: Number(args.duration ?? 600),
            });
            return { ok: true };
        },
    },

    mute_group_all: {
        description: '全员禁言/解除全员禁言',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                enable: { type: 'string', description: '是否开启全员禁言', enum: ['true', 'false'] },
            },
            required: ['group_id', 'enable'],
        },
        async handler(adapter, uin, args) {
            await adapter.muteGroupAll(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                enable: toBool(args.enable),
            });
            return { ok: true };
        },
    },

    set_group_admin: {
        description: '设置/取消群管理员',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                user_id: { type: 'string', description: '用户 ID' },
                enable: { type: 'string', description: '是否设为管理员', enum: ['true', 'false'] },
            },
            required: ['group_id', 'user_id', 'enable'],
        },
        async handler(adapter, uin, args) {
            await adapter.setGroupAdmin(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                user_id: adapter.resolveId(String(args.user_id)),
                enable: toBool(args.enable),
            });
            return { ok: true };
        },
    },

    set_group_card: {
        description: '设置群成员名片（群昵称）',
        inputSchema: {
            type: 'object',
            properties: {
                group_id: { type: 'string', description: '群 ID' },
                user_id: { type: 'string', description: '用户 ID' },
                card: { type: 'string', description: '名片内容，空串则删除' },
            },
            required: ['group_id', 'user_id', 'card'],
        },
        async handler(adapter, uin, args) {
            await adapter.setGroupCard(uin, {
                group_id: adapter.resolveId(String(args.group_id)),
                user_id: adapter.resolveId(String(args.user_id)),
                card: String(args.card ?? ''),
            });
            return { ok: true };
        },
    },

    handle_group_request: {
        description: '处理加群请求/邀请（同意/拒绝）',
        inputSchema: {
            type: 'object',
            properties: {
                flag: { type: 'string', description: '请求标识' },
                type: { type: 'string', description: '请求类型', enum: ['request', 'invitation'] },
                approve: { type: 'string', description: '是否同意', enum: ['true', 'false'] },
                reason: { type: 'string', description: '拒绝理由（拒绝时可选）' },
            },
            required: ['flag', 'type', 'approve'],
        },
        async handler(adapter, uin, args) {
            await adapter.handleGroupRequest(uin, {
                flag: String(args.flag),
                type: String(args.type) as 'request' | 'invitation',
                approve: toBool(args.approve),
                reason: args.reason ? String(args.reason) : undefined,
            } as any);
            return { ok: true };
        },
    },

    // ---- 频道 / Guild ----
    get_guild_list: {
        description: '获取已加入的频道（Guild）列表',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            const list = await adapter.getGuildList(uin);
            return list.map(g => ({ guild_id: g.guild_id.string, guild_name: g.guild_name }));
        },
    },

    get_guild_info: {
        description: '获取频道（Guild）详情',
        inputSchema: {
            type: 'object',
            properties: { guild_id: { type: 'string', description: '频道 ID' } },
            required: ['guild_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getGuildInfo(uin, { guild_id: adapter.resolveId(String(args.guild_id)) });
            return { guild_id: info.guild_id.string, guild_name: info.guild_name };
        },
    },

    get_channel_list: {
        description: '获取频道（Guild）下的子频道列表',
        inputSchema: {
            type: 'object',
            properties: { guild_id: { type: 'string', description: '频道 ID' } },
            required: ['guild_id'],
        },
        async handler(adapter, uin, args) {
            const list = await adapter.getChannelList(uin, { guild_id: adapter.resolveId(String(args.guild_id)) });
            return list.map(c => ({ channel_id: c.channel_id.string, channel_name: c.channel_name, channel_type: c.channel_type }));
        },
    },

    get_channel_info: {
        description: '获取子频道详情',
        inputSchema: {
            type: 'object',
            properties: { channel_id: { type: 'string', description: '子频道 ID' } },
            required: ['channel_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getChannelInfo(uin, { channel_id: adapter.resolveId(String(args.channel_id)) });
            return { channel_id: info.channel_id.string, channel_name: info.channel_name, channel_type: info.channel_type };
        },
    },

    get_guild_member_info: {
        description: '获取频道成员信息',
        inputSchema: {
            type: 'object',
            properties: {
                guild_id: { type: 'string', description: '频道 ID' },
                user_id: { type: 'string', description: '用户 ID' },
            },
            required: ['guild_id', 'user_id'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.getGuildMemberInfo(uin, {
                guild_id: adapter.resolveId(String(args.guild_id)),
                user_id: adapter.resolveId(String(args.user_id)),
            });
            return { user_id: info.user_id.string, user_name: info.user_name, nickname: info.nickname, role: info.role };
        },
    },

    get_channel_member_list: {
        description: '获取子频道成员列表',
        inputSchema: {
            type: 'object',
            properties: { channel_id: { type: 'string', description: '子频道 ID' } },
            required: ['channel_id'],
        },
        async handler(adapter, uin, args) {
            const list = await adapter.getChannelMemberList(uin, { channel_id: adapter.resolveId(String(args.channel_id)) });
            return list.map(m => ({ user_id: m.user_id.string, user_name: m.user_name, role: m.role }));
        },
    },

    // ---- 文件 ----
    upload_file: {
        description: '上传文件（图片/视频/语音/文件）',
        inputSchema: {
            type: 'object',
            properties: {
                scene_type: { type: 'string', description: '场景类型', enum: ['group', 'private'] },
                scene_id: { type: 'string', description: '场景 ID' },
                name: { type: 'string', description: '文件名' },
                url: { type: 'string', description: '文件 URL' },
            },
            required: ['scene_type', 'scene_id', 'name', 'url'],
        },
        async handler(adapter, uin, args) {
            const info = await adapter.uploadFile(uin, {
                scene_type: String(args.scene_type) as any,
                scene_id: adapter.resolveId(String(args.scene_id)),
                name: String(args.name),
                url: String(args.url),
            });
            return { file_id: info.file_id.string, file_name: info.file_name, url: info.url };
        },
    },

    // ---- 系统 ----
    get_supported_actions: {
        description: '获取当前平台支持的 API 列表',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            try {
                return await adapter.getSupportedActions(uin);
            } catch {
                return Object.keys(TOOL_REGISTRY);
            }
        },
    },

    get_status: {
        description: '获取当前机器人运行状态',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            const status = await adapter.getStatus(uin);
            return { online: status.online, good: status.good };
        },
    },

    get_version: {
        description: '获取实现版本信息',
        inputSchema: { type: 'object', properties: {} },
        async handler(adapter, uin) {
            return await adapter.getVersion(uin);
        },
    },
};

// ============ 对外接口 ============

export const MCP_TOOLS: McpTool[] = Object.entries(TOOL_REGISTRY).map(
    ([name, entry]) => ({ name, description: entry.description, inputSchema: entry.inputSchema }),
);

export async function executeTool(
    adapter: Adapter,
    accountId: string,
    toolName: string,
    args: Record<string, unknown>,
): Promise<McpToolCallResult> {
    const entry = TOOL_REGISTRY[toolName];
    if (!entry) {
        return { content: [{ type: 'text', text: `未知的 Tool: ${toolName}` }], isError: true };
    }
    try {
        const result = await entry.handler(adapter, accountId, args);
        return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] };
    } catch (err: any) {
        return { content: [{ type: 'text', text: `错误: ${err.message || String(err)}` }], isError: true };
    }
}

export function filterTools(
    tools: McpTool[],
    whitelist?: string[],
    blacklist?: string[],
): McpTool[] {
    let result = tools;
    if (whitelist?.length) {
        result = result.filter(t => whitelist.includes(t.name));
    }
    if (blacklist?.length) {
        result = result.filter(t => !blacklist.includes(t.name));
    }
    return result;
}
