import { AdapterRegistry } from "onebots";
import type { Schema } from "onebots";
import { Platform } from "./types.js";

export type { ICQQConfig, ICQQProtocol, Platform } from "./types.js";
export * from "./adapter.js";
export { icqqCapabilities } from "./capabilities.js";
export * from "./events.js";
export * from "./media.js";
export * from "./messages.js";
export { buildICQQClientConfig, parseICQQNumericId, parseICQQUin } from "./client-config.js";
export { executeICQQPlatformAction, ICQQ_PLATFORM_ACTIONS } from "./platform-actions.js";

export const icqqSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "QQ 号",
        pattern: /^[1-9]\d{4,11}$/,
        ui: { section: "credentials" },
    },
    password: {
        type: "string",
        label: "QQ 密码",
        description: "留空使用扫码登录",
        sensitive: true,
        ui: { section: "credentials" },
    },
    protocol: {
        platform: {
            type: "number",
            default: Platform.AndroidPad,
            label: "登录平台",
            description: "模拟的客户端类型，默认安卓平板 (aPad)",
            ui: { section: "transport" },
            choices: [
                { value: Platform.Android, label: "安卓手机 (Android)" },
                { value: Platform.AndroidPad, label: "安卓平板 (aPad)" },
                { value: Platform.AndroidWatch, label: "安卓手表 (Watch)" },
                { value: Platform.MacOS, label: "MacOS" },
                { value: Platform.iPad, label: "iPad" },
                { value: Platform.Tim, label: "Tim" },
            ],
            validator: value => {
                // 数值枚举会有反向映射，只接受数字取值
                const allowed = Object.values(Platform).filter(
                    (v): v is Platform => typeof v === "number",
                );
                return allowed.includes(value as Platform) ? true : "无效的登录平台";
            },
        },
        ver: {
            type: "string",
            label: "APK 版本",
            description: "留空使用 ICQQ 内置版本",
            ui: { section: "advanced" },
        },
        sign_api_addr: {
            type: "string",
            label: "签名服务器地址",
            placeholder: "http://127.0.0.1:8080",
            pattern: /^https?:\/\/[^\s]+$/,
            ui: { section: "transport" },
        },
        data_dir: {
            type: "string",
            default: "data",
            label: "数据目录",
            description: "相对进程工作目录；默认 data",
            placeholder: "data",
            ui: { section: "advanced" },
        },
        // 默认 undefined：不写入空对象 {}，避免污染配置
        log_config: {
            type: "object",
            label: "log4js 配置",
            description: "可选；留空则使用 ICQQ 默认日志配置",
            placeholder: "留空表示不配置",
            ui: { section: "advanced" },
        },
        ignore_self: {
            type: "boolean",
            default: true,
            label: "过滤机器人自身消息",
            ui: { section: "filter" },
        },
        resend: {
            type: "boolean",
            default: true,
            label: "风控时分片发送",
            ui: { section: "delivery" },
        },
        reconn_interval: {
            type: "number",
            min: 0,
            max: 300,
            default: 5,
            label: "网络重连间隔（秒）",
            description: "设为 0 关闭 ICQQ 自动重连",
            ui: { section: "transport" },
        },
        cache_group_member: {
            type: "boolean",
            default: true,
            label: "缓存群成员列表",
            ui: { section: "advanced" },
        },
        auto_server: {
            type: "boolean",
            default: true,
            label: "自动选择 QQ 服务器",
            ui: { section: "transport" },
        },
        ffmpeg_path: {
            type: "string",
            label: "ffmpeg 路径",
            ui: { section: "advanced" },
        },
        ffprobe_path: {
            type: "string",
            label: "ffprobe 路径",
            ui: { section: "advanced" },
        },
    },
};

AdapterRegistry.registerSchema("icqq", icqqSchema);
