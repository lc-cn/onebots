/**
 * Discord Lite - 轻量版 Discord 客户端
 *
 * 特性：
 * - 使用原生 fetch，无外部依赖
 * - 自动检测运行时环境
 * - Node.js: 支持 Gateway WebSocket
 * - Cloudflare Workers / Vercel: 支持 Interactions Webhook
 *
 * @example Node.js Gateway 模式
 * ```ts
 * import { DiscordLite, GatewayIntents } from './lite';
 *
 * const client = new DiscordLite({
 *   token: 'your-bot-token',
 *   intents: GatewayIntents.Guilds | GatewayIntents.GuildMessages | GatewayIntents.MessageContent,
 *   mode: 'gateway',
 * });
 *
 * client.on('messageCreate', (message) => {
 *   console.log(message.content);
 * });
 *
 * await client.start();
 * ```
 *
 * @example Cloudflare Workers Webhook 模式
 * ```ts
 * import { DiscordLite, InteractionsHandler } from './lite';
 *
 * const handler = new InteractionsHandler({
 *   publicKey: 'your-public-key',
 *   token: 'your-bot-token',
 *   applicationId: 'your-app-id',
 * });
 *
 * handler.onCommand('hello', async (interaction) => {
 *   return InteractionsHandler.messageResponse('Hello, World!');
 * });
 *
 * export default {
 *   fetch: (request) => handler.handleRequest(request),
 * };
 * ```
 */

import { EventEmitter } from 'events';
import { DiscordREST, type RESTOptions } from './rest.js';
import { DiscordGateway, GatewayIntents, type GatewayOptions } from './gateway.js';
import {
    InteractionsHandler,
    InteractionType,
    InteractionCallbackType,
    verifyInteractionSignature,
    type InteractionWebhookOptions
} from './interactions.js';
import { DiscordLiteBot, type DiscordLiteBotConfig } from './bot.js';
import type { DiscordApiUser, CreateMessageBody, EditMessageBody } from '../types.js';

// 重新导出
export { DiscordREST, type RESTOptions } from './rest.js';
export { DiscordGateway, GatewayIntents, GatewayOpcodes, type GatewayOptions } from './gateway.js';
export {
    InteractionsHandler,
    InteractionType,
    InteractionCallbackType,
    verifyInteractionSignature,
    type InteractionWebhookOptions
} from './interactions.js';
export { DiscordLiteBot, type DiscordLiteBotConfig } from './bot.js';
export type {
    DiscordUser,
    DiscordMessage,
    DiscordGuild,
    DiscordChannel,
    DiscordMember,
    DiscordAttachment
} from './bot.js';

/**
 * 运行时类型
 */
export type RuntimeType = 'node' | 'cloudflare' | 'vercel' | 'deno' | 'bun' | 'browser' | 'unknown';

/**
 * 检测当前运行时环境
 */
export function detectRuntime(): RuntimeType {
    // Cloudflare Workers
    if (typeof globalThis.caches !== 'undefined' && typeof (globalThis as Record<string, unknown>).WebSocketPair !== 'undefined') {
        return 'cloudflare';
    }

    // Vercel Edge Runtime
    if (typeof (globalThis as Record<string, unknown>).EdgeRuntime !== 'undefined') {
        return 'vercel';
    }

    // Deno
    if (typeof (globalThis as Record<string, unknown>).Deno !== 'undefined') {
        return 'deno';
    }

    // Bun
    if (typeof (globalThis as Record<string, unknown>).Bun !== 'undefined') {
        return 'bun';
    }

    // Node.js
    if (typeof process !== 'undefined' && process.versions?.node) {
        return 'node';
    }

    // Browser
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
        return 'browser';
    }

    return 'unknown';
}

/**
 * 检测是否支持 WebSocket Gateway
 */
export function supportsGateway(): boolean {
    const runtime = detectRuntime();
    return ['node', 'bun', 'deno'].includes(runtime);
}

/**
 * Discord Lite 配置
 */
export interface DiscordLiteOptions {
    token: string;
    intents?: number;
    proxy?: {
        url: string;
        username?: string;
        password?: string;
    };
    mode?: 'gateway' | 'interactions' | 'auto';
    // Interactions 模式需要
    publicKey?: string;
    applicationId?: string;
}

/**
 * Discord Lite 统一客户端
 */
export class DiscordLite extends EventEmitter {
    private options: DiscordLiteOptions;
    private gateway: DiscordGateway | null = null;
    private interactions: InteractionsHandler | null = null;
    private rest: DiscordREST;
    private runtime: RuntimeType;
    private mode: 'gateway' | 'interactions';
    private user: DiscordApiUser | null = null;

    constructor(options: DiscordLiteOptions) {
        super();
        this.options = options;
        this.runtime = detectRuntime();
        this.rest = new DiscordREST({ token: options.token, proxy: options.proxy });

        // 确定运行模式
        if (options.mode === 'auto' || !options.mode) {
            this.mode = supportsGateway() ? 'gateway' : 'interactions';
        } else {
            this.mode = options.mode;
        }

        console.log(`[DiscordLite] 运行时: ${this.runtime}, 模式: ${this.mode}`);
    }

    /**
     * 启动客户端（Gateway 模式）
     */
    async start(): Promise<void> {
        if (this.mode !== 'gateway') {
            throw new Error('start() 仅支持 Gateway 模式，Interactions 模式请使用 handleRequest()');
        }

        if (!supportsGateway()) {
            throw new Error(`当前运行时 ${this.runtime} 不支持 Gateway 模式`);
        }

        const intents = this.options.intents ?? (
            GatewayIntents.Guilds |
            GatewayIntents.GuildMessages |
            GatewayIntents.DirectMessages |
            GatewayIntents.MessageContent
        );

        this.gateway = new DiscordGateway({
            token: this.options.token,
            intents,
            proxy: this.options.proxy,
        });

        // 转发事件
        this.gateway.on('ready', (user: unknown) => {
            this.user = user as DiscordApiUser;
            this.emit('ready', user);
        });

        this.gateway.on('messageCreate', (message: unknown) => this.emit('messageCreate', message));
        this.gateway.on('messageUpdate', (message: unknown) => this.emit('messageUpdate', message));
        this.gateway.on('messageDelete', (data: unknown) => this.emit('messageDelete', data));
        this.gateway.on('guildCreate', (guild: unknown) => this.emit('guildCreate', guild));
        this.gateway.on('guildDelete', (guild: unknown) => this.emit('guildDelete', guild));
        this.gateway.on('guildMemberAdd', (member: unknown) => this.emit('guildMemberAdd', member));
        this.gateway.on('guildMemberRemove', (member: unknown) => this.emit('guildMemberRemove', member));
        this.gateway.on('interactionCreate', (interaction: unknown) => this.emit('interactionCreate', interaction));
        this.gateway.on('dispatch', (event: unknown, data: unknown) => this.emit('dispatch', event, data));
        this.gateway.on('error', (error: unknown) => this.emit('error', error));
        this.gateway.on('close', (code: unknown, reason: unknown) => this.emit('close', code, reason));

        await this.gateway.connect();
    }

    /**
     * 停止客户端
     */
    stop(): void {
        if (this.gateway) {
            this.gateway.disconnect();
            this.gateway = null;
        }
    }

    /**
     * 初始化 Interactions 处理器
     */
    initInteractions(): InteractionsHandler {
        if (!this.options.publicKey || !this.options.applicationId) {
            throw new Error('Interactions 模式需要 publicKey 和 applicationId');
        }

        this.interactions = new InteractionsHandler({
            publicKey: this.options.publicKey,
            token: this.options.token,
            applicationId: this.options.applicationId,
        });

        return this.interactions;
    }

    /**
     * 处理 HTTP 请求（Interactions 模式）
     */
    async handleRequest(request: Request): Promise<Response> {
        if (!this.interactions) {
            this.initInteractions();
        }
        return this.interactions!.handleRequest(request);
    }

    /**
     * 获取 REST 客户端
     */
    getREST(): DiscordREST {
        return this.rest;
    }

    /**
     * 获取当前用户
     */
    getUser(): DiscordApiUser | null {
        return this.user;
    }

    /**
     * 获取当前运行时
     */
    getRuntime(): RuntimeType {
        return this.runtime;
    }

    /**
     * 获取当前模式
     */
    getMode(): 'gateway' | 'interactions' {
        return this.mode;
    }

    // ============================================
    // 便捷方法
    // ============================================

    /** 发送消息 */
    async sendMessage(channelId: string, content: string | CreateMessageBody) {
        return this.rest.createMessage(channelId, content);
    }

    /** 编辑消息 */
    async editMessage(channelId: string, messageId: string, content: string | EditMessageBody) {
        return this.rest.editMessage(channelId, messageId, content);
    }

    /** 删除消息 */
    async deleteMessage(channelId: string, messageId: string) {
        return this.rest.deleteMessage(channelId, messageId);
    }

    /** 获取消息 */
    async getMessage(channelId: string, messageId: string) {
        return this.rest.getMessage(channelId, messageId);
    }

    /** 获取服务器 */
    async getGuild(guildId: string) {
        return this.rest.getGuild(guildId);
    }

    /** 获取服务器成员 */
    async getGuildMember(guildId: string, userId: string) {
        return this.rest.getGuildMember(guildId, userId);
    }
}

/**
 * 创建 Discord Lite 客户端的便捷方法
 */
export function createClient(options: DiscordLiteOptions): DiscordLite {
    return new DiscordLite(options);
}
