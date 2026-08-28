import type { Schema, ValidationRule } from '@onebots/core';
import { BaseAppConfigSchema, AdapterRegistry, ProtocolRegistry } from '@onebots/core';
import { ADAPTER_SCHEMA_PRESETS } from './adapter-schema-presets.js';

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

type EndpointField = NonNullable<NonNullable<ValidationRule['ui']>['fields']>[number];

const endpointList = (
    label: string,
    description: string,
    schemes: string[],
    fields: EndpointField[] = []
): ValidationRule => ({
    type: 'array',
    default: [],
    label,
    description,
    ui: {
        widget: 'endpoint-list',
        itemLabel: label.includes('WebSocket') ? '连接' : 'Webhook',
        addLabel: label.includes('WebSocket') ? '添加连接' : '添加 Webhook',
        schemes,
        fields
    }
});

const general: Schema = {
    'onebot.v11': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        access_token: { type: 'string', default: '', label: 'Access Token' },
        secret: { type: 'string', default: '', label: 'Secret' },
        enable_cors: { type: 'boolean', default: true, label: '启用 CORS' },
        heartbeat_interval: { type: 'number', default: 5, min: 1, label: '心跳间隔(秒)' },
        http_reverse: endpointList('HTTP 反向上报', '将事件 POST 到已有的 HTTP 服务，可配置多个目标。', ['http:', 'https:']),
        ws_reverse: endpointList('反向 WebSocket', '由 OneBots 主动连接下游 WebSocket 服务，可配置多个目标。', ['ws:', 'wss:']),
    },
    'onebot.v12': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        access_token: { type: 'string', default: '', label: 'Access Token' },
        secret: { type: 'string', default: '', label: 'Secret' },
        enable_cors: { type: 'boolean', default: true, label: '启用 CORS' },
        heartbeat_interval: { type: 'number', default: 5, min: 1, label: '心跳间隔(秒)' },
        http_webhook: endpointList('HTTP Webhook', '将事件 POST 到已有的 HTTP 服务，可配置多个目标。', ['http:', 'https:']),
        ws_reverse: endpointList('反向 WebSocket', '由 OneBots 主动连接下游 WebSocket 服务，可配置多个目标。', ['ws:', 'wss:']),
        request_timeout: { type: 'number', default: 15, min: 1, label: '请求超时(秒)' },
    },
    'satori.v1': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        token: { type: 'string', default: '', label: 'Token' },
        platform: { type: 'string', default: 'unknown', label: '平台标识' },
        webhooks: endpointList('Webhook', '将事件推送到下游 HTTP 服务。展开单项可覆盖 Token。', ['http:', 'https:'], [
            { key: 'token', label: 'Token', sensitive: true, placeholder: '留空则使用全局 Token' }
        ]),
    },
    'milky.v1': {
        use_http: { type: 'boolean', default: true, label: '启用 HTTP' },
        use_ws: { type: 'boolean', default: true, label: '启用 WebSocket' },
        access_token: { type: 'string', default: '', label: 'Access Token' },
        secret: { type: 'string', default: '', label: 'Secret' },
        heartbeat: { type: 'number', default: 5, min: 1, label: '心跳间隔(秒)' },
        http_reverse: endpointList('HTTP 反向上报', '将事件 POST 到下游服务。展开单项可覆盖鉴权与超时。', ['http:', 'https:'], [
            { key: 'access_token', label: 'Access Token', sensitive: true, placeholder: '留空则使用全局 Token' },
            { key: 'secret', label: '签名 Secret', sensitive: true, placeholder: '留空则使用全局 Secret' },
            { key: 'post_timeout', label: '超时（秒）', type: 'number', placeholder: '例如 15' }
        ]),
        ws_reverse: endpointList('反向 WebSocket', '由 OneBots 主动连接下游服务。展开单项可覆盖鉴权与重连间隔。', ['ws:', 'wss:'], [
            { key: 'access_token', label: 'Access Token', sensitive: true, placeholder: '留空则使用全局 Token' },
            { key: 'reconnect_interval', label: '重连间隔（秒）', type: 'number', placeholder: '例如 5' }
        ]),
    },
};

const baseWithLabels: Schema = {
    port: withLabel('port', '监听端口', '服务监听端口，范围 1-65535'),
    path: withLabel('path', '服务路径前缀', 'HTTP 服务前缀路径，可为空'),
    database: withLabel('database', '数据库文件', '数据库文件名或路径'),
    timeout: withLabel('timeout', '登录超时(秒)', '账号登录超时秒数'),
    username: withLabel('username', '管理端用户名', 'Web 管理端登录用户名（与鉴权码二选一）'),
    password: withLabel('password', '管理端密码', 'Web 管理端登录密码（与鉴权码二选一）'),
    access_token: withLabel('access_token', '管理端鉴权码', 'Bearer 鉴权码，配置后可使用 Authorization: Bearer <鉴权码> 访问 API，无需用户名密码'),
    log_level: withLabel('log_level', '日志等级', 'trace | debug | info | warn | error | fatal | mark | off'),
    public_static_dir: withLabel(
        'public_static_dir',
        '站点根静态目录',
        '相对配置文件目录或绝对路径，用于企业微信等可信域名校验文件（站点根路径 GET）；留空不启用。Docker：配置 static 并将校验文件放入挂载卷内 /data/static',
    ),
};

export type ConfigSchemaBundle = {
    base: Schema;
    general: Schema;
    protocols: Record<string, Schema>;
    adapters: Record<string, Schema>;
};

export const getAppConfigSchema = (): ConfigSchemaBundle => {
    const registeredProtocols = ProtocolRegistry.getAllSchemas();
    const protocolKeys = new Set([...Object.keys(registeredProtocols), ...Object.keys(general)]);
    const protocols = Object.fromEntries(
        [...protocolKeys].map(key => [key, {
            ...(registeredProtocols[key] ?? {}),
            ...((general[key] as Schema | undefined) ?? {})
        }])
    ) as Record<string, Schema>;

    // 预设补全未 -r 加载的适配器 schema，供 Web 配置页使用；已加载时以 Registry 为准（覆盖预设）
    const adapters = {
        ...ADAPTER_SCHEMA_PRESETS,
        ...AdapterRegistry.getAllSchemas(),
    } as Record<string, Schema>;

    return {
        base: baseWithLabels,
        general,
        protocols,
        adapters,
    };
};
