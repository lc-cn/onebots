import { Adapter, WebSocketReceiver, WSSReceiver, WebhookReceiver, SSEReceiver, Message, type PrivateMessageEvent, type ChannelMessageEvent } from 'imhelper';
import { SatoriV1Event, SatoriV1Response } from './types.js';
import { HttpClient } from './http-client.js';

export interface SatoriAdapterConfig {
  baseUrl: string;
  selfId: string;
  accessToken?: string;
  receiveMode: 'ws' | 'wss' | 'webhook' | 'sse';
  path?: string; // webhook 路径
  wsUrl?: string; // WebSocket URL（可选，自动构建）
  platform?: string; // 平台名称（可选，用于构建 HTTP 路径）
}

/**
 * 创建 Satori V1 适配器
 */
export function createSatoriAdapter(config: SatoriAdapterConfig): Adapter<string> {
  const { baseUrl, selfId, accessToken, receiveMode, path = '/satori/v1', wsUrl, platform } = config;

  // 解析 baseUrl 获取协议和主机
  const url = new URL(baseUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = url.host;
  
  // 构建 WebSocket URL
  const defaultWsUrl = wsUrl || `${protocol}//${host}${url.pathname}`;

  class SatoriV1AdapterImpl extends Adapter<string> {
    public readonly selfId: string = selfId;
    private httpClient: HttpClient;
    private receiver?: WebSocketReceiver<string> | 
                       WSSReceiver<string> | 
                       WebhookReceiver<string> | 
                       SSEReceiver<string>;
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

    transformEvent(event: SatoriV1Event): void {
      this.transformAndEmit(event);
    }

    private transformAndEmit(event: SatoriV1Event): void {
      // Satori 事件格式转换
      const eventType = event.type || '';
      
      // 消息事件
      if (eventType.startsWith('message-')) {
        if (eventType === 'message-created' && event.message) {
          // 判断是私聊还是群聊/频道
          const channel = event.channel;
          const guild = event.guild;
          const userId = event.user?.id || '';
          const messageId = event.message.id || String(Date.now());
          const timestamp = Math.floor((event.message.created_at || event.timestamp) / 1000);
          
          if (channel && guild) {
            // 频道消息
            const messageData: ChannelMessageEvent.Data<string> = {
              timestamp,
              bot_id: event.self_id,
              message_id: messageId,
              user_id: userId,
              channel_id: channel.id,
              content: (typeof event.message.content === 'string' 
                ? event.message.content 
                : event.message.content || []) as Message.Content,
              message_type: 'channel',
            };
            (this as any).emit('message.channel', messageData);
          } else {
            // 私聊消息
            const messageData: PrivateMessageEvent.Data<string> = {
              timestamp,
              bot_id: event.self_id,
              message_id: messageId,
              user_id: userId,
              content: (typeof event.message.content === 'string' 
                ? event.message.content 
                : event.message.content || []) as Message.Content,
              message_type: 'private',
            };
            (this as any).emit('message.private', messageData);
          }
        } else if (eventType === 'message-deleted' && event.message) {
          // 消息删除通知
          const noticeData: any = {
            timestamp: Math.floor(event.timestamp / 1000),
            bot_id: event.self_id,
            notice_type: event.channel ? 'group_message_delete' : 'private_message_delete',
            message_id: event.message.id,
          };
          
          if (event.channel) {
            noticeData.channel_id = event.channel.id;
          }
          if (event.user) {
            noticeData.user_id = event.user.id;
          }
          if (event.operator) {
            noticeData.operator_id = event.operator.id;
          }
          
          (this as any).emit(`notice.${noticeData.notice_type}`, noticeData);
        }
      }
      // 群组成员事件
      else if (eventType.startsWith('guild-member-')) {
        const noticeData: any = {
          timestamp: Math.floor(event.timestamp / 1000),
          bot_id: event.self_id,
          notice_type: eventType === 'guild-member-added' ? 'group_member_increase' : 'group_member_decrease',
        };
        
        if (event.guild) {
          noticeData.group_id = event.guild.id;
        }
        if (event.user) {
          noticeData.user_id = event.user.id;
        }
        if (event.operator) {
          noticeData.operator_id = event.operator.id;
        }
        
        (this as any).emit(`notice.${noticeData.notice_type}`, noticeData);
      }
      // 好友请求事件
      else if (eventType === 'friend-request') {
        const requestData: any = {
          timestamp: Math.floor(event.timestamp / 1000),
          bot_id: event.self_id,
          request_type: 'friend',
          request_id: String(event.id || Date.now()),
          user_id: event.user?.id || '',
          comment: event.message?.content || '',
          flag: String(event.id || Date.now()),
        };
        
        (this as any).emit('request.friend', requestData);
      }
      // 群组请求事件
      else if (eventType === 'guild-request') {
        const requestData: any = {
          timestamp: Math.floor(event.timestamp / 1000),
          bot_id: event.self_id,
          request_type: 'group',
          request_id: String(event.id || Date.now()),
          user_id: event.user?.id || '',
          group_id: event.guild?.id || '',
          comment: event.message?.content || '',
          flag: String(event.id || Date.now()),
        };
        
        (this as any).emit('request.group', requestData);
      }
      
      // 转发原始事件
      (this as any).emit('event', event);
    }

    async sendMessage(options: Adapter.SendMessageOptions<string>): Promise<SatoriV1Response> {
      const { scene_type, scene_id, message } = options;
      
      // Satori 使用 message.create API
      return this.httpClient.post('/message.create', {
        channel_id: scene_id,
        content: message,
      });
    }

    async recallMessage(message_id: string): Promise<boolean> {
      // Satori 使用 message.delete API，但需要 channel_id
      // 由于我们没有 channel_id，这里暂时抛出错误
      throw new Error('recallMessage requires channel_id in Satori, use deleteMessage instead');
    }

    async getUserInfo(user_id: string): Promise<import('imhelper').User<string>> {
      const response = await this.httpClient.post('/user.get', {
        user_id,
      });
      if ((response.code === undefined || response.code === 0) && response.data) {
        const userData: import('imhelper').User.Data<string> = {
          user_id: response.data.id || user_id,
          user_name: response.data.name || response.data.username || '',
          avatar: response.data.avatar || '',
        };
        return { info: userData } as any;
      }
      throw new Error('Failed to get user info');
    }

    async getFriendInfo(user_id: string): Promise<import('imhelper').Friend<string>> {
      // Satori 没有单独的 get_friend_info，使用 get_user_info
      const user = await this.getUserInfo(user_id);
      const friendData: import('imhelper').Friend.Data<string> = {
        ...user.info,
        remark: '',
      };
      return { info: friendData } as any;
    }

    async getUserList(): Promise<import('imhelper').User<string>[]> {
      // Satori 没有 getUserList，返回空数组
      return [];
    }

    async getGroupInfo(group_id: string): Promise<import('imhelper').Group<string>> {
      // Satori 使用 guild.get API
      const response = await this.httpClient.post('/guild.get', {
        guild_id: group_id,
      });
      if ((response.code === undefined || response.code === 0) && response.data) {
        const groupData: import('imhelper').Group.Data<string> = {
          group_id: response.data.id || group_id,
          group_name: response.data.name || '',
          avatar: response.data.avatar || '',
        };
        return { info: groupData } as any;
      }
      throw new Error('Failed to get group info');
    }

    async getGroupList(): Promise<import('imhelper').Group<string>[]> {
      const response = await this.httpClient.post('/guild.list', {});
      if ((response.code === undefined || response.code === 0) && Array.isArray(response.data)) {
        return response.data.map((item: any) => {
          const groupData: import('imhelper').Group.Data<string> = {
            group_id: item.id,
            group_name: item.name || '',
            avatar: item.avatar || '',
          };
          return { info: groupData } as any;
        });
      }
      return [];
    }

    async getGroupMemberInfo(group_id: string, user_id: string): Promise<import('imhelper').User<string>> {
      const response = await this.httpClient.post('/guild.member.get', {
        guild_id: group_id,
        user_id,
      });
      if ((response.code === undefined || response.code === 0) && response.data) {
        const userData: import('imhelper').User.Data<string> = {
          user_id: response.data.user?.id || response.data.user_id || user_id,
          user_name: response.data.user?.name || response.data.nickname || '',
          avatar: response.data.user?.avatar || response.data.avatar || '',
        };
        return { info: userData } as any;
      }
      throw new Error('Failed to get group member info');
    }

    async getGroupMemberList(group_id: string): Promise<import('imhelper').User<string>[]> {
      const response = await this.httpClient.post('/guild.member.list', {
        guild_id: group_id,
      });
      if ((response.code === undefined || response.code === 0) && Array.isArray(response.data)) {
        return response.data.map((item: any) => {
          const userData: import('imhelper').User.Data<string> = {
            user_id: item.user?.id || item.user_id,
            user_name: item.user?.name || item.nickname || '',
            avatar: item.user?.avatar || item.avatar || '',
          };
          return { info: userData } as any;
        });
      }
      return [];
    }

    async kickGroupMember(group_id: string, user_id: string): Promise<void> {
      await this.httpClient.post('/guild.member.kick', {
        guild_id: group_id,
        user_id,
      });
    }

    async setGroupMemberMute(group_id: string, user_id: string, duration: number): Promise<void> {
      await this.httpClient.post('/guild.member.mute', {
        guild_id: group_id,
        user_id,
        duration,
      });
    }

    async getMessage(message_id: string): Promise<import('imhelper').MessageEvent<string>> {
      // Satori 的 message.get 需要 channel_id，这里暂时抛出错误
      throw new Error('getMessage requires channel_id in Satori');
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

  return new SatoriV1AdapterImpl();
}

