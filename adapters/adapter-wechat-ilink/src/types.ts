/**
 * wechat-ilink：微信扩展 / iLink Bot HTTP 适配器配置
 *
 * 约定（由适配器注入，无需在 YAML 填写）：
 * - API：`https://ilinkai.weixin.qq.com`
 * - CDN：`https://novac2c.cdn.weixin.qq.com/c2c`
 * - `bot_type`：`3`
 * - `qr_login`：`true`（无会话时扫码）
 * - token / ilink_bot_id：来自会话文件 `{cwd}/data/wechat-ilink/<account_id>.json`
 *
 * YAML 仅需 `account_id`（隐含在键名中）及可选轮询/超时调优字段。
 */
export interface WechatIlinkConfig {
    /** 账号标识（OneBots 内唯一） */
    account_id: string;
    /** 登录后由会话文件提供（运行时） */
    token?: string;
    /** 登录后由会话文件提供（运行时） */
    ilink_bot_id?: string;
    /** API 根地址（适配器固定为 ilinkai.weixin.qq.com） */
    base_url: string;
    /** CDN 根地址（适配器固定为 novac2c.cdn.weixin.qq.com/c2c） */
    cdn_base_url: string;
    /** 路由标签（约定为不设置，除非将来扩展） */
    route_tag?: string;
    /** get_bot_qrcode 的 bot_type（适配器固定为 "3"） */
    bot_type: string;
    /** 无会话时是否扫码（适配器固定为 true） */
    qr_login: boolean;
    /** 扫码登录总超时（毫秒），默认 480000 */
    qr_login_timeout_ms?: number;
    /** getupdates 长轮询超时（毫秒） */
    polling_timeout_ms?: number;
    /** 轮询出错后的重试间隔（毫秒） */
    polling_retry_delay_ms?: number;
}
