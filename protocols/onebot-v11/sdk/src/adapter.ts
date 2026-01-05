import { Adapter, WebSocketReceiver, WSSReceiver, WebhookReceiver, SSEReceiver, Message, type PrivateMessageEvent, type GroupMessageEvent } from 'imhelper';
import { OneBotV11Event, OneBotV11Response } from './types.js';
import { HttpClient } from './http-client.js';

export interface OneBotV11AdapterConfig {
  baseUrl: string;
  selfId: string;
  accessToken?: string;
  receiveMode: 'ws' | 'wss' | 'webhook' | 'sse';
  path?: string; // webhook 路径
  wsUrl?: string; // WebSocket URL（可选，自动构建）
  platform?: string; // 平台名称（可选，用于构建 HTTP 路径）
}
export type Segment = {
  type: string;
  data: Record<string, any>;
}

/**
 * 创建 OneBot V11 适配器
 */
export function createOnebot11Adapter(config: OneBotV11AdapterConfig): Adapter<number> {
  const { baseUrl, selfId, accessToken, receiveMode, path = '/onebot/v11', wsUrl, platform } = config;

  // 解析 baseUrl 获取协议和主机
  const url = new URL(baseUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = url.host;
  
  // 构建 WebSocket URL
  const defaultWsUrl = wsUrl || `${protocol}//${host}${url.pathname}`;

  class OneBotV11AdapterImpl extends Adapter<number> {
    public readonly selfId: string = selfId;
    private httpClient: HttpClient;
    private receiver?: WebSocketReceiver<number> | 
                       WSSReceiver<number> | 
                       WebhookReceiver<number> | 
                       SSEReceiver<number>;
    private readonly receiveMode: typeof receiveMode;
    private readonly defaultWsUrl: string;
    private readonly accessToken?: string;
    private readonly path: string;
    private readonly baseUrl: string;

    constructor() {
      super();
      
      this.receiveMode = receiveMode;
      this.defaultWsUrl = defaultWsUrl;
      this.accessToken = accessToken;
      this.path = path;
      this.baseUrl = baseUrl;
      
      // 优先使用传入的 platform，否则从 baseUrl 解析，最后使用默认值
      let resolvedPlatform = platform || 'unknown';
      let accountId = selfId;
      
      // 如果 baseUrl 包含路径且没有传入 platform，尝试解析
      if (!platform && url.pathname && url.pathname !== '/') {
        const parts = url.pathname.split('/').filter((p: string) => p);
        if (parts.length >= 2) {
          resolvedPlatform = parts[0];
          accountId = parts[1];
        }
      }
      
      this.httpClient = new HttpClient({
        baseUrl,
        accessToken,
        platform: resolvedPlatform,
        accountId,
      });

      this.setupReceiver();
    }

    private setupReceiver(): void {
      switch (this.receiveMode) {
        case 'ws':
          this.receiver = new WebSocketReceiver(this, this.defaultWsUrl, this.accessToken);
          break;
        case 'wss':
          const wssPath = new URL(this.defaultWsUrl).pathname;
          this.receiver = new WSSReceiver(this, wssPath, this.accessToken);
          break;
        case 'webhook':
          const webhookPath = `/${this.selfId}${this.path}`;
          this.receiver = new WebhookReceiver(this, webhookPath, this.accessToken);
          break;
        case 'sse':
          const sseUrl = `${this.baseUrl.replace(/\/$/, '')}/events`;
          this.receiver = new SSEReceiver(this, sseUrl, this.accessToken);
          break;
      }
    }

    transformEvent(event: OneBotV11Event): void {
      this.transformAndEmit(event);
    }

    private transformAndEmit(event: OneBotV11Event): void {
      // 转换为统一的事件格式
      if (event.post_type === 'message') {
        const messageType = event.message_type || 'private';
        const userId = event.user_id;
        const messageId = event.message_id;
        
        if (messageType === 'private') {
          const messageData: PrivateMessageEvent.Data<number> = {
            timestamp: event.time,
            bot_id: event.self_id,
            message_id: messageId,
            user_id: userId,
            content: (event.message || []) as Message.Content,
            message_type: 'private',
            raw_message: (event as any).raw_message,
          };
          (this as any).emit('message.private', messageData);
        } else {
          const messageData: GroupMessageEvent.Data<number> = {
            timestamp: event.time,
            bot_id: event.self_id,
            message_id: messageId,
            user_id: userId,
            group_id: event.group_id!,
            content: (event.message || []) as Message.Content,
            message_type: 'group',
            raw_message: (event as any).raw_message,
          };
          (this as any).emit('message.group', messageData);
        }
      }
      
      // 转发原始事件
      (this as any).emit('event', event);
    }

    async sendMessage(options: Adapter.SendMessageOptions<number>): Promise<OneBotV11Response> {
      const { scene_type, scene_id, message } = options;
      
      if (scene_type === 'private') {
        return this.httpClient.post('/send_private_msg', {
          user_id: scene_id,
          message,
        });
      } else {
        // group 或 channel（V11 中频道映射为群）
        return this.httpClient.post('/send_group_msg', {
          group_id: scene_id,
          message,
        });
      }
    }

    async recallMessage(message_id: number): Promise<boolean> {
      const response = await this.httpClient.post('/delete_msg', {
        message_id,
      });
      return response.status === 'ok';
    }

    async getUserInfo(user_id: number): Promise<import('imhelper').User<number>> {
      const response = await this.httpClient.post('/get_stranger_info', {
        user_id,
      });
      if (response.status === 'ok' && response.data) {
        const userData: import('imhelper').User.Data<number> = {
          user_id: response.data.user_id,
          user_name: response.data.nickname || '',
          avatar: response.data.avatar || '',
        };
        // 创建临时 User 实例，helper 会在使用时被替换
        return { info: userData } as any;
      }
      throw new Error('Failed to get user info');
    }

    async getFriendInfo(user_id: number): Promise<import('imhelper').Friend<number>> {
      // OneBot V11 没有单独的 get_friend_info，使用 get_stranger_info
      const user = await this.getUserInfo(user_id);
      const friendData: import('imhelper').Friend.Data<number> = {
        ...user.info,
        remark: '',
      };
      return { info: friendData } as any;
    }

    async getUserList(): Promise<import('imhelper').User<number>[]> {
      // OneBot V11 没有 getUserList，返回空数组
      return [];
    }

    async getGroupInfo(group_id: number): Promise<import('imhelper').Group<number>> {
      const response = await this.httpClient.post('/get_group_info', {
        group_id,
      });
      if (response.status === 'ok' && response.data) {
        const groupData: import('imhelper').Group.Data<number> = {
          group_id: response.data.group_id,
          group_name: response.data.group_name || '',
          avatar: '',
        };
        return { info: groupData } as any;
      }
      throw new Error('Failed to get group info');
    }

    async getGroupList(): Promise<import('imhelper').Group<number>[]> {
      const response = await this.httpClient.post('/get_group_list', {});
      if (response.status === 'ok' && Array.isArray(response.data)) {
        return response.data.map((item: any) => {
          const groupData: import('imhelper').Group.Data<number> = {
            group_id: item.group_id,
            group_name: item.group_name || '',
            avatar: '',
          };
          return { info: groupData } as any;
        });
      }
      return [];
    }

    async getGroupMemberInfo(group_id: number, user_id: number): Promise<import('imhelper').User<number>> {
      const response = await this.httpClient.post('/get_group_member_info', {
        group_id,
        user_id,
      });
      if (response.status === 'ok' && response.data) {
        const userData: import('imhelper').User.Data<number> = {
          user_id: response.data.user_id,
          user_name: response.data.nickname || response.data.card || '',
          avatar: response.data.avatar || '',
        };
        return { info: userData } as any;
      }
      throw new Error('Failed to get group member info');
    }

    async getGroupMemberList(group_id: number): Promise<import('imhelper').User<number>[]> {
      const response = await this.httpClient.post('/get_group_member_list', {
        group_id,
      });
      if (response.status === 'ok' && Array.isArray(response.data)) {
        return response.data.map((item: any) => {
          const userData: import('imhelper').User.Data<number> = {
            user_id: item.user_id,
            user_name: item.nickname || item.card || '',
            avatar: item.avatar || '',
          };
          return { info: userData } as any;
        });
      }
      return [];
    }

    async kickGroupMember(group_id: number, user_id: number): Promise<void> {
      await this.httpClient.post('/set_group_kick', {
        group_id,
        user_id,
      });
    }

    async setGroupMemberMute(group_id: number, user_id: number, duration: number): Promise<void> {
      await this.httpClient.post('/set_group_ban', {
        group_id,
        user_id,
        duration,
      });
    }

    async setGroupMemberAdmin(group_id: number, user_id: number, admin: boolean = true): Promise<void> {
      await this.httpClient.post('/set_group_admin', {
        group_id,
        user_id,
        enable: admin,
      });
    }

    async setGroupMemberCard(group_id: number, user_id: number, card: string): Promise<void> {
      await this.httpClient.post('/set_group_card', {
        group_id,
        user_id,
        card,
      });
    }

    async setGroupName(group_id: number, name: string): Promise<void> {
      await this.httpClient.post('/set_group_name', {
        group_id,
        group_name: name,
      });
    }

    async leaveGroup(group_id: number): Promise<void> {
      await this.httpClient.post('/set_group_leave', {
        group_id,
      });
    }

    async approveFriendRequest(request_id: number, approve: boolean, comment?: string): Promise<void> {
      await this.httpClient.post('/set_friend_add_request', {
        flag: String(request_id),
        approve,
        remark: comment,
      });
    }

    async approveGroupRequest(request_id: number, approve: boolean, reason?: string): Promise<void> {
      await this.httpClient.post('/set_group_add_request', {
        flag: String(request_id),
        sub_type: 'add',
        approve,
        reason,
      });
    }

    async getMessage(message_id: number): Promise<import('imhelper').MessageEvent<number>> {
      const response = await this.httpClient.post('/get_msg', {
        message_id,
      });
      if (response.status === 'ok' && response.data) {
        // 这里需要根据实际返回的数据构造 MessageEvent
        // 由于需要 helper 实例，这里暂时抛出错误，由调用方处理
        throw new Error('getMessage requires helper instance, use helper.getMessage instead');
      }
      throw new Error('Failed to get message');
    }

    async start(port?: number): Promise<void> {
      if (this.receiver) {
        if (this.receiveMode === 'wss' || this.receiveMode === 'webhook') {
          await this.receiver.connect(port || 8080);
        } else {
          // ws 和 sse 模式不需要 port 参数
          await this.receiver.connect();
        }
      }
    }

    async stop(): Promise<void> {
      if (this.receiver) {
        await this.receiver.disconnect();
      }
    }
  }

  return new OneBotV11AdapterImpl();
}
