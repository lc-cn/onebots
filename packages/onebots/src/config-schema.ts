import type { Schema, ValidationRule } from "@onebots/core";
import { BaseAppConfigSchema, AdapterRegistry, ProtocolRegistry } from "@onebots/core";

/**
 * App 层配置 Schema（可在此扩展）
 */
const base = BaseAppConfigSchema as Schema;

const withLabel = (
    key: keyof typeof base,
    label: string,
    description?: string,
    section: NonNullable<ValidationRule["ui"]>["section"] = "advanced",
    sensitive = false,
): ValidationRule => {
    const rule = base[key] as ValidationRule;
    return {
        ...rule,
        label,
        description,
        ui: { ...rule.ui, section },
        ...(sensitive ? { sensitive: true } : {}),
    };
};

const baseWithLabels: Schema = {
    port: withLabel("port", "监听端口", "服务监听端口，范围 1-65535"),
    path: withLabel("path", "服务路径前缀", "HTTP 服务前缀路径，可为空"),
    database: withLabel("database", "数据库文件", "数据库文件名或路径"),
    timeout: withLabel("timeout", "登录超时(秒)", "账号登录超时秒数"),
    username: withLabel(
        "username",
        "管理端用户名",
        "Web 管理端登录用户名（与鉴权码二选一）",
        "credentials",
    ),
    password: withLabel(
        "password",
        "管理端密码",
        "Web 管理端登录密码（与鉴权码二选一）",
        "credentials",
        true,
    ),
    access_token: withLabel(
        "access_token",
        "管理端鉴权码",
        "Bearer 鉴权码，配置后可使用 Authorization: Bearer <鉴权码> 访问 API，无需用户名密码",
        "credentials",
        true,
    ),
    log_level: withLabel(
        "log_level",
        "日志等级",
        "trace | debug | info | warn | error | fatal | mark | off",
    ),
    public_static_dir: withLabel(
        "public_static_dir",
        "站点根静态目录",
        "相对配置文件目录或绝对路径，用于企业微信等可信域名校验文件（站点根路径 GET）；留空不启用。Docker：配置 static 并将校验文件放入挂载卷内 /data/static",
    ),
};

export type ConfigSchemaBundle = {
    base: Schema;
    general: Schema;
    protocols: Record<string, Schema>;
    adapters: Record<string, Schema>;
};

export const getAppConfigSchema = (): ConfigSchemaBundle => {
    // 插件在应用启动前完成注册。Registry 是配置、校验与 Web 表单的唯一真相源，
    // 未加载的插件不应出现在管理端，也不应由主程序维护一份易漂移的影子 Schema。
    const protocols = ProtocolRegistry.getAllSchemas();
    const adapters = AdapterRegistry.getAllSchemas();

    return {
        base: baseWithLabels,
        general: protocols,
        protocols,
        adapters,
    };
};
