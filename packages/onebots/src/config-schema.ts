import type { Schema } from '@onebots/core';
import { BaseAppConfigSchema, AdapterRegistry, ProtocolRegistry } from '@onebots/core';

/**
 * App 层配置 Schema（可在此扩展）
 */
const base = BaseAppConfigSchema as Schema;

const withLabel = (key: keyof typeof base, label: string, description?: string) => {
    return {
        ...(base[key] as any),
        label,
        description,
    } as (typeof base)[typeof key];
};

const general: Schema = {
    'onebot.v11': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        access_token: { type: 'string', default: '', label: 'Access Token' },
        secret: { type: 'string', default: '', label: 'Secret' },
        enable_cors: { type: 'boolean', default: true, label: '启用 CORS' },
        heartbeat_interval: { type: 'number', default: 5, min: 1, label: '心跳间隔(秒)' },
        http_reverse: { type: 'array', default: [], label: 'HTTP 反向上报地址' },
        ws_reverse: { type: 'array', default: [], label: 'WS 反向连接地址' },
    },
    'onebot.v12': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        access_token: { type: 'string', default: '', label: 'Access Token' },
        secret: { type: 'string', default: '', label: 'Secret' },
        enable_cors: { type: 'boolean', default: true, label: '启用 CORS' },
        heartbeat_interval: { type: 'number', default: 5, min: 1, label: '心跳间隔(秒)' },
        webhooks: { type: 'array', default: [], label: 'Webhook 上报地址' },
        ws_reverse: { type: 'array', default: [], label: 'WS 反向连接地址' },
        request_timeout: { type: 'number', default: 15, min: 1, label: '请求超时(秒)' },
    },
    'satori.v1': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        token: { type: 'string', default: '', label: 'Token' },
        platform: { type: 'string', default: 'unknown', label: '平台标识' },
        webhooks: { type: 'array', default: [], label: 'Webhook 上报地址' },
    },
    'milky.v1': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        access_token: { type: 'string', default: '', label: 'Access Token' },
        secret: { type: 'string', default: '', label: 'Secret' },
        heartbeat: { type: 'number', default: 5, min: 1, label: '心跳间隔(秒)' },
        http_reverse: { type: 'array', default: [], label: 'HTTP 反向上报地址' },
        ws_reverse: { type: 'array', default: [], label: 'WS 反向连接地址' },
    },
};

const baseWithLabels: Schema = {
    port: withLabel('port', '监听端口', '服务监听端口，范围 1-65535'),
    path: withLabel('path', '服务路径前缀', 'HTTP 服务前缀路径，可为空'),
    database: withLabel('database', '数据库文件', '数据库文件名或路径'),
    timeout: withLabel('timeout', '登录超时(秒)', '账号登录超时秒数'),
    username: withLabel('username', '管理端用户名', 'Web 管理端登录用户名'),
    password: withLabel('password', '管理端密码', 'Web 管理端登录密码'),
    log_level: withLabel('log_level', '日志等级', 'trace | debug | info | warn | error | fatal | mark | off'),
};

export type ConfigSchemaBundle = {
    base: Schema;
    general: Schema;
    protocols: Record<string, Schema>;
    adapters: Record<string, Schema>;
};

export const getAppConfigSchema = (): ConfigSchemaBundle => {
    const protocols = {
        ...general,
        ...ProtocolRegistry.getAllSchemas(),
    } as Record<string, Schema>;

    const adapters = {
        ...AdapterRegistry.getAllSchemas(),
    } as Record<string, Schema>;

    return {
        base: baseWithLabels,
        general,
        protocols,
        adapters,
    };
};
