import WebSocket from "ws";
import { Protocol, ProtocolRegistry } from "onebots";
import type { Schema } from "onebots";
import { Account } from "onebots";
import { Adapter } from "onebots";
import crypto from "crypto";
import { CommonEvent, CommonTypes } from "onebots";
import { CQCode } from "./cqcode.js";
import { OneBotV11Config } from "./config.js";

const onebotV11Schema: Schema = {
    use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
    use_ws: { type: 'boolean', default: false, label: '启用 WebSocket' },
    http_reverse: { type: 'array', label: 'HTTP 反向上报地址' },
    ws_reverse: { type: 'array', label: 'WS 反向连接地址' },
    enable_cors: { type: 'boolean', label: '启用 CORS' },
    access_token: { type: 'string', label: 'Access Token' },
    secret: { type: 'string', label: 'Secret' },
    post_timeout: { type: 'number', label: 'POST 超时(秒)' },
    post_message_format: { type: 'string', enum: ['string', 'array'], default: 'array', label: '消息格式' },
    serve_data_files: { type: 'boolean', label: '静态文件服务' },
    heartbeat_interval: { type: 'number', label: '心跳间隔(秒)' },
};

ProtocolRegistry.registerSchema('onebot.v11', onebotV11Schema);

/**
 * OneBot V11 Protocol Implementation
 * Implements the OneBot 11 standard
 * Reference: https://github.com/botuniverse/onebot-v11
 */
export class OneBotV11Protocol extends Protocol<"v11",OneBotV11Config.Config> {
    public readonly name = "onebot";
    public readonly version = "v11" as const;
    
    // Message ID transformation maps (V11 requires integer message IDs)
    private messageIdMap = new Map<number, string>();
    private reverseMessageIdMap = new Map<string, number>();
    private messageIdCounter = 0;
    
    // Heartbeat timer
    private heartbeatTimer?: NodeJS.Timeout;

    constructor(adapter: Adapter, account: Account, config: OneBotV11Config.Config) {
        super(adapter, account, {
            ...config,
            protocol: "onebot",
            version: "v11",
        });
    }
    get db(){
        return this.adapter.app.db;
    }
    
    /**
     * Start the OneBot V11 protocol service
     */
    start(): void {
        // Initialize communication methods
        if (this.config.use_http) {
            this.startHttp();
        }
        if (this.config.use_ws) {
            this.startWebSocket();
        }
        if (this.config.http_reverse?.length > 0) {
            this.config.http_reverse.forEach(url => this.startHttpReverse(url));
        }
        if (this.config.ws_reverse?.length > 0) {
            this.config.ws_reverse.forEach(url => this.startWsReverse(url));
        }
    }

    /**
     * Stop the protocol service
     */
    async stop(force?: boolean): Promise<void> {
        this.logger.info(`Stopping OneBot V11 protocol`);
        
        // Clear heartbeat timer
        if (this.heartbeatTimer) {
            clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = undefined;
        }
        
        // Clean up resources
        this.messageIdMap.clear();
        this.reverseMessageIdMap.clear();
        this.removeAllListeners();
    }

    /**
     * Dispatch event to OneBot V11 format
     */
    dispatch(event: any): void {
        this.logger.debug(`[OneBot V11] Received event:`, event.type, event.message_type || '');
        
        // 检查 filterFn
        let filterResult: boolean;
        try {
            filterResult = this.filterFn(event);
            this.logger.debug(`[OneBot V11] Filter result:`, filterResult);
        } catch (error) {
            this.logger.error(`[OneBot V11] Filter error:`, error);
            return;
        }
        
        if (!filterResult) {
            this.logger.debug(`[OneBot V11] Event filtered out:`, event.type);
            return;
        }
        
        this.logger.debug(`[OneBot V11] Event passed filter, converting...`);
        
        try {
            const v11Event = this.convertToV11Format(event);
            this.logger.debug(`[OneBot V11] Conversion completed, result:`, v11Event ? 'success' : 'null');
            
            if (v11Event) {
                const eventData = JSON.stringify(v11Event);
                this.logger.debug(`[OneBot V11] Converted event:`, eventData.substring(0, 200));
                this.logger.debug(`[OneBot V11] Emitting dispatch event, listener count:`, this.listenerCount("dispatch"));
                this.emit("dispatch", eventData);
                this.logger.debug(`[OneBot V11] Event dispatched to WebSocket clients`);
            } else {
                this.logger.warn(`[OneBot V11] Failed to convert event to V11 format:`, event.type, JSON.stringify(event).substring(0, 200));
            }
        } catch (error) {
            this.logger.error(`[OneBot V11] Error converting event to V11 format:`, error, JSON.stringify(event).substring(0, 200));
        }
    }
    /**
     * Format event data to OneBot V11 specification
     */
    format(event: string, payload: any): any {
        return {
            time: Math.floor(Date.now() / 1000),
            self_id: this.adapter.resolveId(this.account.account_id).number,
            post_type: event,
            ...payload,
        };
    }

    /**
     * Apply OneBot V11 API action
     */
    async apply(action: string, params?: any): Promise<any> {
        this.logger.debug(`OneBot V11 action: ${action}`, params);
        
        try {
            const result = await this.executeAction(action, params);
            return {
                status: "ok",
                retcode: 0,
                data: result,
            };
        } catch (error) {
            this.logger.error(`OneBot V11 action ${action} failed:`, error);
            return {
                status: "failed",
                retcode: -1,
                msg: error.message,
            };
        }
    }

    /**
     * Execute OneBot V11 action
     */
    private async executeAction(action: string, params: any = {}): Promise<any> {
        switch (action) {
            // Message API
            case "send_private_msg":
                return this.sendPrivateMsg(params);
            case "send_group_msg":
                return this.sendGroupMsg(params);
            case "send_msg":
                return this.sendMsg(params);
            case "delete_msg":
                return this.deleteMsg(params);
            case "get_msg":
                return this.getMsg(params);
            case "get_forward_msg":
                return this.getForwardMsg(params);
            case "send_like":
                return this.sendLike(params);
            case "set_group_kick":
                return this.setGroupKick(params);
            case "set_group_ban":
                return this.setGroupBan(params);
            case "set_group_anonymous_ban":
                return this.setGroupAnonymousBan(params);
            case "set_group_whole_ban":
                return this.setGroupWholeBan(params);
            case "set_group_admin":
                return this.setGroupAdmin(params);
            case "set_group_anonymous":
                return this.setGroupAnonymous(params);
            case "set_group_card":
                return this.setGroupCard(params);
            case "set_group_name":
                return this.setGroupName(params);
            case "set_group_leave":
                return this.setGroupLeave(params);
            case "set_group_special_title":
                return this.setGroupSpecialTitle(params);
            case "set_friend_add_request":
                return this.setFriendAddRequest(params);
            case "set_group_add_request":
                return this.setGroupAddRequest(params);
            
            // Info API
            case "get_login_info":
                return this.getLoginInfo(params);
            case "get_stranger_info":
                return this.getStrangerInfo(params);
            case "get_friend_list":
                return this.getFriendList(params);
            case "get_group_info":
                return this.getGroupInfo(params);
            case "get_group_list":
                return this.getGroupList(params);
            case "get_group_member_info":
                return this.getGroupMemberInfo(params);
            case "get_group_member_list":
                return this.getGroupMemberList(params);
            case "get_group_honor_info":
                return this.getGroupHonorInfo(params);
            
            // Other API
            case "get_cookies":
                return this.getCookies(params);
            case "get_csrf_token":
                return this.getCsrfToken(params);
            case "get_credentials":
                return this.getCredentials(params);
            case "get_record":
                return this.getRecord(params);
            case "get_image":
                return this.getImage(params);
            case "can_send_image":
                return this.canSendImage(params);
            case "can_send_record":
                return this.canSendRecord(params);
            case "get_status":
                return this.getStatus(params);
            case "get_version_info":
                return this.getVersionInfo(params);
            case "set_restart":
                return this.setRestart(params);
            case "clean_cache":
                return this.cleanCache(params);
            
            default:
                throw new Error(`Unknown action: ${action}`);
        }
    }

    // ============ Message API Implementations ============
    
    private async sendPrivateMsg(params: any): Promise<any> {
        const { user_id, message, auto_escape = false } = params;
        const segments = this.parseMessage(message, auto_escape);
        
        return  await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "private",
            scene_id: this.adapter.resolveId(user_id),
            message: segments,
        });
    }

    private async sendGroupMsg(params: any): Promise<any> {
        const { group_id, message, auto_escape = false } = params;
        const segments = this.parseMessage(message, auto_escape);
        
        const result = await this.adapter.sendMessage(this.account.account_id, {
            scene_type: "group",
            scene_id: this.adapter.resolveId(group_id),
            message: segments,
        });
        
        return {
            message_id: result.message_id.number,
        };
    }

    private async sendMsg(params: any): Promise<any> {
        const { message_type, user_id, group_id, message, auto_escape = false } = params;
        
        if (message_type === "private") {
            return this.sendPrivateMsg({ user_id, message, auto_escape });
        } else if (message_type === "group") {
            return this.sendGroupMsg({ group_id, message, auto_escape });
        }
        
        throw new Error("Invalid message_type");
    }

    private async deleteMsg(params: any): Promise<void> {
        const { message_id } = params;
        
        await this.adapter.deleteMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_id),
        });
    }

    private async getMsg(params: any): Promise<any> {
        const { message_id } = params;
        
        const msg = await this.adapter.getMessage(this.account.account_id, {
            message_id: this.adapter.resolveId(message_id),
        });
        
        return this.convertMessageInfoToV11(msg);
    }

    private async getForwardMsg(params: any): Promise<any> {
        // Forward message retrieval - implementation depends on platform support
        throw new Error("get_forward_msg not implemented");
    }

    private async sendLike(params: any): Promise<void> {
        // Send like/thumbs up - implementation depends on platform support
        throw new Error("send_like not implemented");
    }

    // ============ Group Management API Implementations ============
    
    private async setGroupKick(params: any): Promise<void> {
        const { group_id, user_id, reject_add_request = false } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_kick not implemented");
    }

    private async setGroupBan(params: any): Promise<void> {
        const { group_id, user_id, duration = 30 * 60 } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_ban not implemented");
    }

    private async setGroupAnonymousBan(params: any): Promise<void> {
        // Implementation depends on platform support
        throw new Error("set_group_anonymous_ban not implemented");
    }

    private async setGroupWholeBan(params: any): Promise<void> {
        const { group_id, enable = true } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_whole_ban not implemented");
    }

    private async setGroupAdmin(params: any): Promise<void> {
        const { group_id, user_id, enable = true } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_admin not implemented");
    }

    private async setGroupAnonymous(params: any): Promise<void> {
        const { group_id, enable = true } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_anonymous not implemented");
    }

    private async setGroupCard(params: any): Promise<void> {
        const { group_id, user_id, card = "" } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_card not implemented");
    }

    private async setGroupName(params: any): Promise<void> {
        const { group_id, group_name } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_name not implemented");
    }

    private async setGroupLeave(params: any): Promise<void> {
        const { group_id, is_dismiss = false } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_leave not implemented");
    }

    private async setGroupSpecialTitle(params: any): Promise<void> {
        const { group_id, user_id, special_title = "", duration = -1 } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_special_title not implemented");
    }

    // ============ Request Handling API Implementations ============
    
    private async setFriendAddRequest(params: any): Promise<void> {
        const { flag, approve = true, remark = "" } = params;
        // Implementation depends on adapter support
        throw new Error("set_friend_add_request not implemented");
    }

    private async setGroupAddRequest(params: any): Promise<void> {
        const { flag, sub_type, approve = true, reason = "" } = params;
        // Implementation depends on adapter support
        throw new Error("set_group_add_request not implemented");
    }

    // ============ Info API Implementations ============
    
    private async getLoginInfo(params: any): Promise<any> {
        return {
            user_id: Number(this.account.account_id),
            nickname: this.account.account_id,
        };
    }

    private async getStrangerInfo(params: any): Promise<any> {
        const { user_id, no_cache = false } = params;
        
        const userInfo = await this.adapter.getUserInfo(this.account.account_id, {
            user_id: this.adapter.resolveId(user_id),
        });
        
        return {
            user_id,
            nickname: userInfo.user_name,
            sex: "unknown",
            age: 0,
        };
    }

    private async getFriendList(params: any): Promise<any> {
        const friends = await this.adapter.getFriendList(this.account.account_id);
        
        return friends.map(friend => ({
            user_id: Number(friend.user_id),
            nickname: friend.user_name,
            remark: friend.remark || "",
        }));
    }

    private async getGroupInfo(params: any): Promise<any> {
        const { group_id, no_cache = false } = params;
        
        const groupInfo = await this.adapter.getGroupInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
        });
        
        return {
            group_id,
            group_name: groupInfo.group_name,
            member_count: groupInfo.member_count || 0,
            max_member_count: groupInfo.max_member_count || 0,
        };
    }

    private async getGroupList(params: any): Promise<any> {
        const groups = await this.adapter.getGroupList(this.account.account_id);
        
        return groups.map(group => ({
            group_id: group.group_id.number,
            group_name: group.group_name,
            member_count: group.member_count || 0,
            max_member_count: group.max_member_count || 0,
        }));
    }

    private async getGroupMemberInfo(params: any): Promise<any> {
        const { group_id, user_id, no_cache = false } = params;
        
        const memberInfo = await this.adapter.getGroupMemberInfo(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
            user_id: this.adapter.resolveId(user_id),
        });
        
        return {
            group_id: group_id,
            user_id: user_id,
            nickname: memberInfo.user_name,
            card: memberInfo.card || "",
            sex: "unknown",
            age: 0,
            area: "",
            join_time: 0,
            last_sent_time: 0,
            level: "",
            role: memberInfo.role || "member",
            unfriendly: false,
            title: "",
            title_expire_time: 0,
            card_changeable: false,
        };
    }

    private async getGroupMemberList(params: any): Promise<any> {
        const { group_id } = params;
        
        const members = await this.adapter.getGroupMemberList(this.account.account_id, {
            group_id: this.adapter.resolveId(group_id),
        });
        
        return members.map(member => ({
            group_id: group_id,
            user_id: member.user_id.number,
            nickname: member.user_name,
            card: member.card || "",
            sex: "unknown",
            age: 0,
            area: "",
            join_time: 0,
            last_sent_time: 0,
            level: "",
            role: member.role || "member",
            unfriendly: false,
            title: "",
            title_expire_time: 0,
            card_changeable: false,
        }));
    }

    private async getGroupHonorInfo(params: any): Promise<any> {
        const { group_id, type } = params;
        // Implementation depends on platform support
        throw new Error("get_group_honor_info not implemented");
    }

    // ============ Other API Implementations ============
    
    private async getCookies(params: any): Promise<any> {
        const { domain = "" } = params;
        // Implementation depends on platform support
        throw new Error("get_cookies not implemented");
    }

    private async getCsrfToken(params: any): Promise<any> {
        // Implementation depends on platform support
        throw new Error("get_csrf_token not implemented");
    }

    private async getCredentials(params: any): Promise<any> {
        const { domain = "" } = params;
        // Implementation depends on platform support
        throw new Error("get_credentials not implemented");
    }

    private async getRecord(params: any): Promise<any> {
        const { file, out_format } = params;
        // Implementation depends on platform support
        throw new Error("get_record not implemented");
    }

    private async getImage(params: any): Promise<any> {
        const { file } = params;
        // Implementation depends on platform support
        throw new Error("get_image not implemented");
    }

    private async canSendImage(params: any): Promise<any> {
        return { yes: true };
    }

    private async canSendRecord(params: any): Promise<any> {
        return { yes: true };
    }

    private async getStatus(params: any): Promise<any> {
        return {
            online: true,
            good: true,
        };
    }

    private async getVersionInfo(params: any): Promise<any> {
        return {
            app_name: "onebots",
            app_version: "1.0.0",
            protocol_version: "v11",
        };
    }

    private async setRestart(params: any): Promise<void> {
        const { delay = 0 } = params;
        // Implementation for restarting
        throw new Error("set_restart not implemented");
    }

    private async cleanCache(params: any): Promise<void> {
        // Clear caches
        this.messageIdMap.clear();
        this.reverseMessageIdMap.clear();
    }

    // ============ Utility Methods ============
    
    /**
     * Convert common event to OneBot V11 format
     */
    private convertToV11Format(event: CommonEvent.Event): any {
        try {
            const base = {
                time: Math.floor(event.timestamp / 1000),
                self_id: this.transformToInt(this.account.account_id),
            };

            if (event.type === "message") {
                // OneBot V11 只支持 private 和 group，将 channel 和 direct 映射为 group
                let messageType = event.message_type;
                if (messageType === "channel" || messageType === "direct") {
                    messageType = "group";
                }
                
                // 确保 message_id 和 sender.id 有 number 属性
                const messageIdObj = event.message_id as CommonTypes.Id;
                const senderIdObj = event.sender?.id as CommonTypes.Id;
                
                const messageId = messageIdObj?.number ?? this.transformToInt(messageIdObj?.string || String(messageIdObj || event.message_id));
                const userId = senderIdObj?.number ?? this.transformToInt(senderIdObj?.string || String(senderIdObj || event.sender?.id));
                
                const result = {
                    ...base,
                    post_type: "message",
                    message_type: messageType,
                    sub_type: messageType === "private" ? "friend" : "normal",
                    message_id: messageId,
                    user_id: userId,
                    message: this.convertSegmentsToV11(event.message || []),
                    raw_message: event.raw_message || this.segmentsToString(event.message || []),
                    font: 0,
                    sender: {
                        user_id: userId,
                        nickname: event.sender?.name || "",
                        // 只展开 event.sender 中非 id 的字段，避免将 Id 对象混入
                        ...(event.sender ? Object.fromEntries(
                            Object.entries(event.sender).filter(([key]) => key !== 'id')
                        ) : {}),
                    },
                    ...(event.group ? {
                        group_id: Number((event.group.id as CommonTypes.Id)?.number ?? (event.group.id as CommonTypes.Id)?.string ?? event.group.id),
                    } : {}),
                };
                
                this.logger.debug(`[OneBot V11] Conversion successful:`, {
                    messageType,
                    messageId,
                    userId,
                    hasGroup: !!event.group,
                });
                
                return result;
            } else if (event.type === "notice") {
                return {
                    ...base,
                    post_type: "notice",
                    notice_type: event.notice_type,
                    ...(event.user ? { user_id: (event.user.id as CommonTypes.Id)?.number } : {}),
                    ...(event.operator ? { operator_id: (event.operator.id as CommonTypes.Id)?.number } : {}),
                    ...(event.group ? { group_id: (event.group.id as CommonTypes.Id)?.number } : {}),
                };
            } else if (event.type === "request") {
                return {
                    ...base,
                    post_type: "request",
                    request_type: event.request_type,
                    user_id: (event.user.id as CommonTypes.Id)?.number,
                    comment: event.comment || "",
                    flag: event.flag,
                    ...(event.group ? { group_id: (event.group.id as CommonTypes.Id)?.number } : {}),
                };
            } else if (event.type === "meta") {
                return {
                    ...base,
                    post_type: "meta_event",
                    meta_event_type: event.meta_type,
                    sub_type: event.sub_type,
                };
            }
            
            this.logger.warn(`[OneBot V11] Unknown event type:`, (event as any).type);
            return null;
        } catch (error) {
            this.logger.error(`[OneBot V11] Error in convertToV11Format:`, error, {
                eventType: (event as any).type,
                messageType: (event as any).message_type,
                hasMessageId: !!(event as any).message_id,
                hasSender: !!(event as any).sender,
            });
            throw error;
        }
    }

    /**
     * Convert message segments to V11 format
     */
    private convertSegmentsToV11(segments: CommonTypes.Segment[]): any[] {
        return segments.map(seg => ({
            type: seg.type,
            data: seg.data,
        }));
    }

    /**
     * Parse message (string or array) to segments
     */
    private parseMessage(message: string | any[], auto_escape: boolean): CommonTypes.Segment[] {
        if (Array.isArray(message)) {
            return message.map(seg => ({
                type: seg.type,
                data: seg.data,
            }));
        }
        
        if (auto_escape) {
            return [{ type: "text", data: { text: message } }];
        }
        
        // Parse CQ code format
        return CQCode.parse(message);
    }

    /**
     * Convert segments to plain text string
     */
    private segmentsToString(segments: CommonTypes.Segment[]): string {
        return CQCode.toText(segments);
    }

    /**
     * Transform string message ID to integer (V11 requirement)
     */
    private transformToInt(messageId: string | number | CommonTypes.Id): number {
        // 如果是 Id 对象，使用其 number 属性
        if (messageId && typeof messageId === 'object' && 'number' in messageId) {
            return (messageId as CommonTypes.Id).number;
        }
        
        if (typeof messageId === "number") {
            return messageId;
        }
        
        const idString = String(messageId);
        if (this.reverseMessageIdMap.has(idString)) {
            return this.reverseMessageIdMap.get(idString)!;
        }
        
        const intId = ++this.messageIdCounter;
        this.messageIdMap.set(intId, idString);
        this.reverseMessageIdMap.set(idString, intId);
        return intId;
    }

    /**
     * Transform integer back to original message ID
     */
    private transformFromInt(messageId: number | string): string {
        if (typeof messageId === "string") {
            return messageId;
        }
        
        return this.messageIdMap.get(messageId) || String(messageId);
    }

    /**
     * Convert message info to V11 format
     */
    private convertMessageInfoToV11(msg: Adapter.MessageInfo): any {
        return {
            time: msg.time,
            message_type: msg.sender.scene_type,
            message_id: msg.message_id.number,
            real_id: msg.message_id.number,
            sender: {
                user_id: msg.sender.sender_id.number,
                nickname: msg.sender.sender_name,
            },
            message: this.convertSegmentsToV11(msg.message),
        };
    }

    /**
     * Verify access token
     */
    private verifyToken(token?: string): boolean {
        if (!this.config.access_token) return true;
        return token === this.config.access_token;
    }

    /**
     * Verify signature
     */
    private verifySignature(body: string, signature?: string): boolean {
        if (!this.config.secret) return true;
        if (!signature) return false;
        
        const hmac = crypto.createHmac('sha1', this.config.secret);
        const expected = 'sha1=' + hmac.update(body).digest('hex');
        return signature === expected;
    }

    /**
     * Start HTTP server
     */
    private startHttp(): void {
        this.logger.info("Starting HTTP server");
        
        const routePath = `${this.path}/:action`;
        this.logger.info(`[OneBot V11] About to call router.post(${routePath})`);
        this.router.post(routePath, async (ctx) => {
            // Verify access token
            const token = ctx.query.access_token || ctx.headers.authorization?.replace('Bearer ', '');
            if (!this.verifyToken(token as string)) {
                this.logger.warn(`[OneBot V11] Unauthorized request: ${ctx.path}`, {
                    token: token ? 'present' : 'missing',
                    expectedToken: this.config.access_token ? 'configured' : 'not configured',
                });
                ctx.status = 401;
                ctx.body = { status: "failed", retcode: 1403, msg: "Unauthorized" };
                return;
            }

            const action = ctx.params.action;
            const params = (ctx.request as any).body;
            
            this.logger.debug(`[OneBot V11] Processing action: ${action}`, params);

            try {
                const result = await this.apply(action, params);
                ctx.body = result;
                this.logger.debug(`[OneBot V11] Action ${action} completed successfully`);
            } catch (error) {
                this.logger.error(`HTTP API ${action} failed:`, error);
                ctx.body = {
                    status: "failed",
                    retcode: -1,
                    msg: error.message,
                };
            }
        });
    }

    /**
     * Start WebSocket server
     */
    private startWebSocket(): void {
        this.logger.info("Starting WebSocket server");
        
        const wss = this.router.ws(this.path);
        
        wss.on("connection", (ws, request) => {
            // Verify access token
            const url = new URL(request.url!, `ws://localhost`);
            const token = url.searchParams.get('access_token') || request.headers.authorization?.replace('Bearer ', '');
            
            if (!this.verifyToken(token as string)) {
                ws.close(1008, "Unauthorized");
                return;
            }

            this.logger.info(`WebSocket client connected: ${this.path}`);

            // Send meta event: lifecycle.connect
            const connectEvent = this.format("meta_event", {
                meta_event_type: "lifecycle",
                sub_type: "connect",
            });
            ws.send(JSON.stringify(connectEvent));

            // Listen for dispatch events and send to client
            const onDispatch = (data: string) => {
                this.logger.debug(`[OneBot V11] onDispatch called, ws.readyState:`, ws.readyState, `data length:`, data.length);
                if (ws.readyState === WebSocket.OPEN) {
                    try {
                        ws.send(data);
                        this.logger.debug(`[OneBot V11] Message sent to WebSocket client`);
                    } catch (error) {
                        this.logger.error(`[OneBot V11] Error sending message to WebSocket:`, error);
                    }
                } else {
                    this.logger.warn(`[OneBot V11] WebSocket not open, readyState:`, ws.readyState);
                }
            };
            this.on("dispatch", onDispatch);
            this.logger.debug(`[OneBot V11] Dispatch listener registered, listener count:`, this.listenerCount("dispatch"));

            // Handle incoming API calls
            ws.on("message", async (data) => {
                try {
                    const request = JSON.parse(data.toString());
                    const { action, params, echo } = request;

                    const result = await this.apply(action, params);
                    ws.send(JSON.stringify({ ...result, echo }));
                } catch (error) {
                    this.logger.error("WebSocket message error:", error);
                    ws.send(JSON.stringify({
                        status: "failed",
                        retcode: -1,
                        msg: error.message,
                    }));
                }
            });

            ws.on("close", () => {
                this.logger.info(`WebSocket client disconnected: ${this.path}`);
                this.off("dispatch", onDispatch);
            });

            ws.on("error", (error) => {
                this.logger.error("WebSocket error:", error);
            });
        });

        // Setup heartbeat (only once per protocol instance)
        if (this.config.heartbeat_interval && !this.heartbeatTimer) {
            // 配置为秒，转换为毫秒；至少 1 秒
            const intervalMs = Math.max(Number(this.config.heartbeat_interval) || 1, 1) * 1000;
            this.heartbeatTimer = setInterval(() => {
                const heartbeatEvent = this.format("meta_event", {
                    meta_event_type: "heartbeat",
                    status: {
                        online: true,
                        good: true,
                    },
                    interval: intervalMs,
                });
                this.emit("dispatch", JSON.stringify(heartbeatEvent));
            }, intervalMs);
        }

        this.logger.info(`WebSocket server listening on ${this.path}`);
    }

    /**
     * Start HTTP POST (reverse)
     */
    private startHttpReverse(url: string): void {
        this.logger.info(`Starting HTTP reverse to ${url}`);
        

        // Listen for dispatch events and POST to external server
        const onDispatch = async (data: string) => {
            try {
                const headers: any = {
                    'Content-Type': 'application/json',
                    'User-Agent': 'OneBot/11',
                    'X-Self-ID': this.account.account_id,
                };

                // Add access token if configured
                if (this.config.access_token) {
                    headers['Authorization'] = `Bearer ${this.config.access_token}`;
                }

                // Add signature if secret is configured
                if (this.config.secret) {
                    const hmac = crypto.createHmac('sha1', this.config.secret);
                    headers['X-Signature'] = 'sha1=' + hmac.update(data).digest('hex');
                }

                const response = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: data,
                    signal: AbortSignal.timeout(this.config.post_timeout || 5000),
                });

                if (!response.ok) {
                    this.logger.warn(`HTTP POST failed: ${response.status} ${response.statusText}`);
                }
            } catch (error) {
                this.logger.error(`HTTP POST error:`, error);
            }
        };

        this.on("dispatch", onDispatch);
        this.logger.info(`HTTP reverse configured to POST events to ${url}`);
    }

    /**
     * Start WebSocket reverse
     */
    private startWsReverse(url: string): void {
        this.logger.info(`Starting WebSocket reverse to ${url}`);
        let ws: any = null;
        let reconnectTimer: any = null;

        const connect = () => {
            try {
                // Add access token to URL if configured
                let wsUrl = url;
                if (this.config.access_token) {
                    const separator = url.includes('?') ? '&' : '?';
                    wsUrl = `${url}${separator}access_token=${this.config.access_token}`;
                }

                ws = new WebSocket(wsUrl, {
                    headers: {
                        'User-Agent': 'OneBot/11',
                        'X-Self-ID': this.account.account_id,
                        'X-Client-Role': 'Universal',
                    },
                });

                ws.on('open', () => {
                    this.logger.info(`WebSocket reverse connected to ${url}`);
                    
                    // Send meta event: lifecycle.connect
                    const connectEvent = this.format("meta_event", {
                        meta_event_type: "lifecycle",
                        sub_type: "connect",
                    });
                    ws.send(JSON.stringify(connectEvent));

                    // Clear reconnect timer
                    if (reconnectTimer) {
                        clearTimeout(reconnectTimer);
                        reconnectTimer = null;
                    }
                });

                ws.on('message', async (data: Buffer) => {
                    try {
                        const request = JSON.parse(data.toString());
                        const { action, params, echo } = request;

                        const result = await this.apply(action, params);
                        ws.send(JSON.stringify({ ...result, echo }));
                    } catch (error) {
                        this.logger.error("WebSocket reverse message error:", error);
                    }
                });

                ws.on('close', () => {
                    this.logger.warn(`WebSocket reverse disconnected from ${url}, reconnecting in 5s...`);
                    reconnectTimer = setTimeout(connect, 5000);
                });

                ws.on('error', (error: Error) => {
                    this.logger.error("WebSocket reverse error:", error);
                });

                // Listen for dispatch events and send to server
                const onDispatch = (data: string) => {
                    if (ws && ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                    }
                };
                this.on("dispatch", onDispatch);

            } catch (error) {
                this.logger.error(`WebSocket reverse connection failed:`, error);
                reconnectTimer = setTimeout(connect, 5000);
            }
        };

        connect();
    }
}
ProtocolRegistry.register("onebot", "v11", OneBotV11Protocol);
export { CQCode } from "./cqcode.js";
export * from "./types.js";
export * from "./utils.js";
export * from "./config.js";
