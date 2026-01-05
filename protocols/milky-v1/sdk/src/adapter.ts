import { Adapter, WebSocketReceiver, WSSReceiver, WebhookReceiver, SSEReceiver, Message, type PrivateMessageEvent, type GroupMessageEvent } from 'imhelper';
import { MilkyV1Event, MilkyV1Response } from './types.js';
import { HttpClient } from './http-client.js';

export interface MilkyAdapterConfig {
  baseUrl: string;
  selfId: string;
  accessToken?: string;
  receiveMode: 'ws' | 'wss' | 'webhook' | 'sse';
  path?: string; // webhook 路径
  wsUrl?: string; // WebSocket URL（可选，自动构建）
  platform?: string; // 平台名称（可选，用于构建 HTTP 路径）
}

/**
 * 创建 Milky V1 适配器
 */
export function createMilkyAdapter(config: MilkyAdapterConfig): Adapter<string> {
  const { baseUrl, selfId, accessToken, receiveMode, path = '/milky/v1', wsUrl, platform } = config;

  // 解析 baseUrl 获取协议和主机
  const url = new URL(baseUrl);
  const protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  const host = url.host;
  
  // 构建 WebSocket URL
  const defaultWsUrl = wsUrl || `${protocol}//${host}${url.pathname}`;

  class MilkyV1AdapterImpl extends Adapter<string> {
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

  transformEvent(event: MilkyV1Event): void {
    this.transformAndEmit(event);
  }

  private transformAndEmit(event: MilkyV1Event): void {
      // 转换为统一的事件格式
      if (event.post_type === 'message') {
        const messageType = event.message_type || 'private';
        const userId = String(event.user_id || '');
        const messageId = event.message_id || String(Date.now());
        
        if (messageType === 'private') {
          const messageData: PrivateMessageEvent.Data<string> = {
            timestamp: event.time,
            bot_id: String(event.self_id),
            message_id: messageId,
            user_id: userId,
            content: (event.message || []) as Message.Content,
            message_type: 'private',
            raw_message: event.raw_message,
          };
          (this as any).emit('message.private', messageData);
        } else {
          const messageData: GroupMessageEvent.Data<string> = {
            timestamp: event.time,
            bot_id: String(event.self_id),
            message_id: messageId,
            user_id: userId,
            group_id: String(event.group_id || ''),
            content: (event.message || []) as Message.Content,
            message_type: 'group',
            raw_message: event.raw_message,
          };
          (this as any).emit('message.group', messageData);
        }
    } else if (event.post_type === 'notice') {
      // 转换通知事件
      const noticeType = event.notice_type || '';
      const noticeData: any = {
        timestamp: event.time,
        bot_id: String(event.self_id),
        notice_type: noticeType,
        sub_type: event.sub_type || '',
      };

      if (event.user_id) {
        noticeData.user_id = String(event.user_id);
      }
      if (event.group_id) {
        noticeData.group_id = String(event.group_id);
      }
      if ((event as any).operator_id) {
        noticeData.operator_id = String((event as any).operator_id);
      }
      if (event.message_id) {
        noticeData.message_id = String(event.message_id);
      }
      if ((event as any).duration !== undefined) {
        noticeData.duration = (event as any).duration;
      }

      // 映射 Milky 通知类型到 imhelper 通知类型
      const noticeTypeMap: Record<string, string> = {
        'group_increase': 'group_member_increase',
        'group_decrease': 'group_member_decrease',
        'group_recall': 'group_message_delete',
        'friend_recall': 'private_message_delete',
        'friend_add': 'friend_increase',
      };

      const mappedType = noticeTypeMap[noticeType] || noticeType;
      (this as any).emit(`notice.${mappedType}`, noticeData);
    } else if (event.post_type === 'request') {
      // 转换请求事件
      const requestType = event.request_type || '';
      const requestData: any = {
        timestamp: event.time,
        bot_id: String(event.self_id),
        request_id: (event as any).flag || String(Date.now()),
        user_id: String(event.user_id || ''),
        comment: (event as any).comment || '',
        flag: (event as any).flag || '',
      };

      if (event.group_id) {
        requestData.group_id = String(event.group_id);
      }
      if (event.sub_type) {
        requestData.sub_type = event.sub_type;
      }

      (this as any).emit(`request.${requestType}`, requestData);
    } else if (event.post_type === 'meta_event') {
      // 转换元事件
      const metaType = event.meta_event_type || '';
      const metaData: any = {
        timestamp: event.time,
        bot_id: String(event.self_id),
        meta_type: metaType,
      };

      if (event.sub_type) {
        metaData.sub_type = event.sub_type;
      }
      if (metaType === 'heartbeat' && (event as any).interval !== undefined) {
        metaData.interval = (event as any).interval;
      }
      if (metaType === 'lifecycle' && event.sub_type) {
        metaData.sub_type = event.sub_type;
      }
      if ((event as any).status) {
        metaData.status = (event as any).status;
      }

      (this as any).emit(`meta.${metaType}`, metaData);
    }
    
    // 转发原始事件
    (this as any).emit('event', event);
  }

    async sendMessage(options: Adapter.SendMessageOptions<string>): Promise<MilkyV1Response> {
      const { scene_type, scene_id, message } = options;
    
    if (scene_type === 'private') {
      return this.httpClient.post('/send_private_msg', {
        user_id: scene_id,
        message,
      });
    } else {
      // group 或 channel（Milky 中频道映射为群）
      return this.httpClient.post('/send_group_msg', {
        group_id: scene_id,
        message,
      });
    }
  }

    async recallMessage(message_id: string): Promise<boolean> {
      const response = await this.httpClient.post('/delete_msg', {
        message_id,
      });
      return response.status === 'ok';
    }

    async getUserInfo(user_id: string): Promise<import('imhelper').User<string>> {
      const response = await this.httpClient.post('/get_stranger_info', {
        user_id,
      });
      if (response.status === 'ok' && response.data) {
        const userData: import('imhelper').User.Data<string> = {
          user_id: response.data.user_id || user_id,
          user_name: response.data.nickname || response.data.user_name || '',
          avatar: response.data.avatar || '',
        };
        return { info: userData } as any;
      }
      throw new Error('Failed to get user info');
    }

    async getFriendInfo(user_id: string): Promise<import('imhelper').Friend<string>> {
      const user = await this.getUserInfo(user_id);
      const friendData: import('imhelper').Friend.Data<string> = {
        ...user.info,
        remark: '',
      };
      return { info: friendData } as any;
    }

    async getUserList(): Promise<import('imhelper').User<string>[]> {
      return [];
    }

    async getGroupInfo(group_id: string): Promise<import('imhelper').Group<string>> {
      const response = await this.httpClient.post('/get_group_info', {
        group_id,
      });
      if (response.status === 'ok' && response.data) {
        const groupData: import('imhelper').Group.Data<string> = {
          group_id: response.data.group_id || group_id,
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
          user_id: response.data.user_id || user_id,
          user_name: response.data.nickname || response.data.card || response.data.user_name || '',
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
            user_name: item.nickname || item.card || item.user_name || '',
            avatar: item.avatar || '',
          };
          return { info: userData } as any;
        });
      }
      return [];
    }

    async kickGroupMember(group_id: string, user_id: string): Promise<void> {
      await this.httpClient.post('/set_group_kick', {
        group_id,
        user_id,
      });
    }

    async setGroupMemberMute(group_id: string, user_id: string, duration: number): Promise<void> {
      await this.httpClient.post('/set_group_ban', {
        group_id,
        user_id,
        duration,
      });
    }

    async setGroupMemberAdmin(group_id: string, user_id: string, admin: boolean = true): Promise<void> {
      await this.httpClient.post('/set_group_admin', {
        group_id,
        user_id,
        enable: admin,
      });
    }

    async setGroupMemberCard(group_id: string, user_id: string, card: string): Promise<void> {
      await this.httpClient.post('/set_group_card', {
        group_id,
        user_id,
        card,
      });
    }

    async setGroupName(group_id: string, name: string): Promise<void> {
      await this.httpClient.post('/set_group_name', {
        group_id,
        group_name: name,
      });
    }

    async leaveGroup(group_id: string): Promise<void> {
      await this.httpClient.post('/set_group_leave', {
        group_id,
      });
    }

    async approveFriendRequest(request_id: string, approve: boolean, comment?: string): Promise<void> {
      await this.httpClient.post('/set_friend_add_request', {
        flag: request_id,
        approve,
        remark: comment,
      });
    }

    async approveGroupRequest(request_id: string, approve: boolean, reason?: string): Promise<void> {
      await this.httpClient.post('/set_group_add_request', {
        flag: request_id,
        sub_type: 'add',
        approve,
        reason,
      });
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

  return new MilkyV1AdapterImpl();
}

