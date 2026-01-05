import { Adapter, WebSocketReceiver, WSSReceiver, WebhookReceiver, SSEReceiver, Message, type PrivateMessageEvent, type GroupMessageEvent, type ChannelMessageEvent } from 'imhelper';
import { OneBotV12Event, OneBotV12Response, OneBotV12Segment } from './types.js';
import { HttpClient } from './http-client.js';

export interface OneBotV12AdapterConfig {
  baseUrl: string;
  selfId: string;
  accessToken?: string;
  receiveMode: 'ws' | 'wss' | 'webhook' | 'sse';
  wsUrl?: string; // WebSocket URL（可选，自动构建）
  platform?: string; // 平台名称（可选，用于构建 HTTP 路径）
}

export function createOnebot12Adapter(config: OneBotV12AdapterConfig): Adapter<string> {
  const { baseUrl, selfId, accessToken, receiveMode, wsUrl, platform } = config;
  const url = new URL(baseUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const defaultWsUrl = wsUrl || `${protocol}//${url.host}${url.pathname}`;

  class OneBotV12AdapterImpl extends Adapter<string> {
    public readonly selfId: string = selfId;
    private httpClient: HttpClient;
    private receiver?: WebSocketReceiver<string> | 
                       WSSReceiver<string> | 
                       WebhookReceiver<string> | 
                       SSEReceiver<string>;
    private readonly receiveMode: typeof receiveMode;
    private readonly defaultWsUrl: string;
    private readonly accessToken?: string;
    private readonly baseUrl: string;

    constructor() {
      super();
      
      this.receiveMode = receiveMode;
      this.defaultWsUrl = defaultWsUrl;
      this.accessToken = accessToken;
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
        protocol: 'onebot',
        version: 'v12',
      });
      this.setupReceiver();
    }

    private setupReceiver(): void {
      switch (this.receiveMode) {
        case 'ws':
          this.receiver = new WebSocketReceiver(this, this.defaultWsUrl, this.accessToken);
          break;
        case 'wss':
          // WSS 需要路径和端口，这里使用路径
          const wssPath = new URL(this.defaultWsUrl).pathname;
          this.receiver = new WSSReceiver(this, wssPath, this.accessToken);
          break;
        case 'sse':
          const sseUrl = `${this.baseUrl.replace(/\/$/, '')}/events`;
          this.receiver = new SSEReceiver(this, sseUrl, this.accessToken);
          break;
        case 'webhook':
          const webhookPath = `/${this.selfId}/onebot/v12`;
          this.receiver = new WebhookReceiver(this, webhookPath, this.accessToken);
          break;
      }
    }

    transformEvent(event: OneBotV12Event): void {
      this.transformAndEmit(event);
    }

    private transformAndEmit(event: OneBotV12Event): void {
      if (event.type === 'message') {
        const detailType = event.detail_type as 'private' | 'group' | 'channel';
        const userId = event.user_id;
        const messageId = event.message_id;
        const timestamp = event.time;
        
        if (detailType === 'private') {
          const messageData: PrivateMessageEvent.Data<string> = {
            timestamp,
            bot_id: event.self.user_id,
            message_id: messageId,
            user_id: userId,
            content: (event.message || []) as Message.Content,
            message_type: 'private',
          };
          (this as any).emit('message.private', messageData);
        } else if (detailType === 'group') {
          const messageData: GroupMessageEvent.Data<string> = {
            timestamp,
            bot_id: event.self.user_id,
            message_id: messageId,
            user_id: userId,
            group_id: (event as any).group_id,
            content: (event.message || []) as Message.Content,
            message_type: 'group',
          };
          (this as any).emit('message.group', messageData);
        } else if (detailType === 'channel') {
          const messageData: ChannelMessageEvent.Data<string> = {
            timestamp,
            bot_id: event.self.user_id,
            message_id: messageId,
            user_id: userId,
            channel_id: (event as any).channel_id,
            content: (event.message || []) as Message.Content,
            message_type: 'channel',
          };
          (this as any).emit('message.channel', messageData);
        }
      }
      (this as any).emit('event', event);
    }

    async sendMessage(options: Adapter.SendMessageOptions<string>): Promise<OneBotV12Response> {
      const { scene_type, scene_id, message } = options;
      const segments = typeof message === 'string' 
        ? [{ type: 'text', data: { text: message } }]
        : message;
      
      return this.httpClient.post('/send_message', {
        detail_type: scene_type,
        ...(scene_type === 'private' ? { user_id: scene_id } : {}),
        ...(scene_type === 'group' ? { group_id: scene_id } : {}),
        ...(scene_type === 'channel' ? { channel_id: scene_id } : {}),
        message: segments,
      });
    }

    async recallMessage(message_id: string): Promise<boolean> {
      const response = await this.httpClient.post('/delete_message', {
        message_id,
      });
      return response.status === 'ok';
    }

    async getUserInfo(user_id: string): Promise<import('imhelper').User<string>> {
      const response = await this.httpClient.post('/get_user_info', {
        user_id,
      });
      if (response.status === 'ok' && response.data) {
        const userData: import('imhelper').User.Data<string> = {
          user_id: response.data.user_id,
          user_name: response.data.user_name || response.data.nickname || '',
          avatar: response.data.avatar || '',
        };
        return { info: userData } as any;
      }
      throw new Error('Failed to get user info');
    }

    async getFriendInfo(user_id: string): Promise<import('imhelper').Friend<string>> {
      // OneBot V12 没有单独的 get_friend_info，使用 get_user_info
      const user = await this.getUserInfo(user_id);
      const friendData: import('imhelper').Friend.Data<string> = {
        ...user.info,
        remark: '',
      };
      return { info: friendData } as any;
    }

    async getUserList(): Promise<import('imhelper').User<string>[]> {
      // OneBot V12 没有 getUserList，返回空数组
      return [];
    }

    async getGroupInfo(group_id: string): Promise<import('imhelper').Group<string>> {
      const response = await this.httpClient.post('/get_group_info', {
        group_id,
      });
      if (response.status === 'ok' && response.data) {
        const groupData: import('imhelper').Group.Data<string> = {
          group_id: response.data.group_id,
          group_name: response.data.group_name || '',
          avatar: response.data.avatar || '',
        };
        return { info: groupData } as any;
      }
      throw new Error('Failed to get group info');
    }

    async getGroupList(): Promise<import('imhelper').Group<string>[]> {
      const response = await this.httpClient.post('/get_group_list', {});
      if (response.status === 'ok' && Array.isArray(response.data)) {
        return response.data.map((item: any) => {
          const groupData: import('imhelper').Group.Data<string> = {
            group_id: item.group_id,
            group_name: item.group_name || '',
            avatar: item.avatar || '',
          };
          return { info: groupData } as any;
        });
      }
      return [];
    }

    async getGroupMemberInfo(group_id: string, user_id: string): Promise<import('imhelper').User<string>> {
      const response = await this.httpClient.post('/get_group_member_info', {
        group_id,
        user_id,
      });
      if (response.status === 'ok' && response.data) {
        const userData: import('imhelper').User.Data<string> = {
          user_id: response.data.user_id,
          user_name: response.data.user_name || response.data.nickname || '',
          avatar: response.data.avatar || '',
        };
        return { info: userData } as any;
      }
      throw new Error('Failed to get group member info');
    }

    async getGroupMemberList(group_id: string): Promise<import('imhelper').User<string>[]> {
      const response = await this.httpClient.post('/get_group_member_list', {
        group_id,
      });
      if (response.status === 'ok' && Array.isArray(response.data)) {
        return response.data.map((item: any) => {
          const userData: import('imhelper').User.Data<string> = {
            user_id: item.user_id,
            user_name: item.user_name || item.nickname || '',
            avatar: item.avatar || '',
          };
          return { info: userData } as any;
        });
      }
      return [];
    }

    async kickGroupMember(group_id: string, user_id: string): Promise<void> {
      // OneBot V12 没有直接的 kick 方法，可能需要使用其他 API
      throw new Error('kickGroupMember not supported in OneBot V12');
    }

    async setGroupMemberMute(group_id: string, user_id: string, duration: number): Promise<void> {
      // OneBot V12 没有直接的 mute 方法
      throw new Error('setGroupMemberMute not supported in OneBot V12');
    }

    async setGroupName(group_id: string, name: string): Promise<void> {
      await this.httpClient.post('/set_group_name', {
        group_id,
        group_name: name,
      });
    }

    async leaveGroup(group_id: string): Promise<void> {
      await this.httpClient.post('/leave_group', {
        group_id,
      });
    }

    async getMessage(message_id: string): Promise<import('imhelper').MessageEvent<string>> {
      // OneBot V12 没有 get_message API
      throw new Error('getMessage not supported in OneBot V12');
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

  return new OneBotV12AdapterImpl();
}
