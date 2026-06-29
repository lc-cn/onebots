/**
 * 黑盒语音 HTTP REST 客户端
 */
import { createHttpsProxyAgent } from 'onebots';
import { createHeychatAckId } from '../utils.js';
import type {
    HeychatApiResponse,
    HeychatConfig,
    HeychatRoomInfo,
    HeychatSendMessageOptions,
    HeychatSendMessageResult,
} from '../types.js';

const DEFAULT_API_BASE = 'https://chat.xiaoheihe.cn';
const DEFAULT_CHAT_VERSION = '1.30.0';

export class HeychatHttpClient {
    private readonly token: string;
    private readonly apiBase: string;
    private readonly chatVersion: string;
    private readonly proxy?: HeychatConfig['proxy'];

    constructor(config: Pick<HeychatConfig, 'token' | 'api_base' | 'chat_version' | 'proxy'>) {
        this.token = config.token;
        this.apiBase = (config.api_base || DEFAULT_API_BASE).replace(/\/$/, '');
        this.chatVersion = config.chat_version || DEFAULT_CHAT_VERSION;
        this.proxy = config.proxy;
    }

    /** 构建带 bot 身份 query 的 URL */
    private buildUrl(path: string, extraQuery?: Record<string, string>): string {
        const url = new URL(path.startsWith('http') ? path : `${this.apiBase}${path}`);
        const query: Record<string, string> = {
            client_type: 'heybox_chat',
            x_client_type: 'web',
            os_type: 'web',
            x_os_type: 'bot',
            x_app: 'heybox_chat',
            chat_os_type: 'bot',
            chat_version: this.chatVersion,
            nonce: String(Math.floor(Date.now() / 1000)),
            ...extraQuery,
        };
        for (const [key, value] of Object.entries(query)) {
            url.searchParams.set(key, value);
        }
        return url.toString();
    }

    private async request<T>(
        method: string,
        path: string,
        body?: unknown,
        extraQuery?: Record<string, string>,
    ): Promise<T> {
        const url = this.buildUrl(path, extraQuery);
        const agent = this.proxy?.url ? await createHttpsProxyAgent(this.proxy) : null;
        const init: RequestInit = {
            method,
            headers: {
                accept: 'application/json, text/plain, */*',
                'content-type': 'application/json;charset=UTF-8',
                token: this.token,
            },
        };
        if (body !== undefined) {
            init.body = JSON.stringify(body);
        }
        if (agent) {
            (init as RequestInit & { agent?: unknown }).agent = agent;
        }

        const response = await fetch(url, init);
        const text = await response.text();
        let payload: HeychatApiResponse<T> = {};
        try {
            payload = text ? JSON.parse(text) : {};
        } catch {
            throw new Error(`[Heychat] HTTP 响应解析失败: ${text.slice(0, 200)}`);
        }

        if (!response.ok) {
            throw new Error(
                `[Heychat] HTTP ${response.status}: ${payload.msg || payload.message || text.slice(0, 200)}`,
            );
        }
        if (payload.status && payload.status !== 'ok' && payload.status !== 'true') {
            throw new Error(`[Heychat] API 错误: ${payload.msg || payload.message || payload.status}`);
        }
        return (payload.result ?? payload.data ?? payload) as T;
    }

    /** 发送频道消息 */
    async sendChannelMessage(
        roomId: string,
        channelId: string,
        content: string,
        options: HeychatSendMessageOptions = {},
    ): Promise<HeychatSendMessageResult> {
        const body = {
            room_id: roomId,
            channel_id: channelId,
            msg: content,
            msg_type: options.msg_type ?? 1,
            heychat_ack_id: createHeychatAckId(),
            addition: JSON.stringify({ img_files_info: [] }),
            reply_id: options.reply_id || '',
            channel_type: 1,
            at_user_id: options.at_user_id || '',
            at_role_id: '',
            mention_channel_id: '',
        };

        const result = await this.request<{ msg_id?: string; heychat_ack_id?: string }>(
            'POST',
            '/chatroom/v2/channel_msg/send',
            body,
        );

        return {
            msg_id: result.msg_id || '',
            heychat_ack_id: result.heychat_ack_id || body.heychat_ack_id,
        };
    }

    /** 删除频道消息 */
    async deleteChannelMessage(roomId: string, channelId: string, msgId: string): Promise<void> {
        await this.request('POST', '/chatroom/v2/channel_msg/delete', {
            room_id: roomId,
            channel_id: channelId,
            msg_id: msgId,
        });
    }

    /** 获取房间信息 */
    async getRoomInfo(roomId: string): Promise<HeychatRoomInfo> {
        const result = await this.request<Record<string, unknown>>(
            'GET',
            '/chatroom/v2/room/view',
            undefined,
            { room_id: roomId },
        );

        return {
            room_id: String(result.room_id || roomId),
            room_name: (result.room_name as string) || (result.name as string) || '',
            room_avatar: (result.room_avatar as string) || (result.avatar as string) || '',
            member_count: typeof result.member_count === 'number' ? result.member_count : undefined,
        };
    }
}
