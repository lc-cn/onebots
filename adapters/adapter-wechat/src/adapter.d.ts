/**
 * 微信公众号适配器类型声明
 * 扩展 Adapter.Configs 以支持 wechat 平台
 */
import { WechatConfig } from './types.js';

declare module '@/adapter.js' {
    namespace Adapter {
        interface Configs {
            wechat: WechatConfig;
        }
    }
}

export {};
