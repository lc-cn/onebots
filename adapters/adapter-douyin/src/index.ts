import { AdapterRegistry, type Schema } from "onebots";

export type { DouyinConfig, DouyinLoginMethod } from "./types.js";
export { DouyinAdapter } from "./adapter.js";
export { douyinCapabilities } from "./capabilities.js";
export { projectDouyinGroupRequest, projectDouyinMessage, projectDouyinNotice } from "./events.js";
export { compileDouyinMessage, projectDouyinSegments } from "./messages.js";

export const douyinSchema: Schema = {
    account_id: {
        type: "string",
        required: true,
        label: "账号标识",
        description: "首次登录可填写自定义别名；登录成功后 douyin-im 会持久化账号会话",
        ui: { section: "credentials" },
    },
    login_method: {
        type: "string",
        default: "qr",
        label: "登录方式",
        choices: [
            { value: "qr", label: "抖音扫码" },
            { value: "sms", label: "短信验证码" },
            { value: "password", label: "手机号与密码" },
        ],
        ui: { section: "credentials" },
    },
    mobile: {
        type: "string",
        label: "手机号",
        description: "短信或密码登录时必填",
        ui: {
            section: "credentials",
            visibleWhen: { path: "login_method", oneOf: ["sms", "password"] },
        },
    },
    password: {
        type: "string",
        label: "密码",
        sensitive: true,
        description: "密码登录时必填；风控触发后仍可能需要短信或浏览器验证",
        ui: {
            section: "credentials",
            visibleWhen: { path: "login_method", oneOf: ["password"] },
        },
    },
    login_timeout_seconds: {
        type: "number",
        default: 300,
        min: 30,
        max: 1800,
        label: "登录超时（秒）",
        ui: { section: "advanced" },
    },
};

AdapterRegistry.registerSchema("douyin", douyinSchema);
