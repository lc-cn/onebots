/**
 * Intent 名映射：旧名 → SDK 名
 * SDK 已删除 'GROUP_AT_MESSAGE_CREATE' / 'C2C_MESSAGE_CREATE' / 'OPEN_FORUMS_EVENT'，
 * 合并为 'GROUP_AND_C2C_EVENT' 与 'FORUMS_EVENT'。
 * 本文件保留旧名以兼容历史配置，并打印一次性 deprecation 警告。
 */
import type { Intent as SdkIntent } from 'qq-official-bot';
import type { QQIntent } from './types.js';

const LEGACY_TO_SDK: Record<string, SdkIntent> = {
    GROUP_AT_MESSAGE_CREATE: 'GROUP_AND_C2C_EVENT',
    C2C_MESSAGE_CREATE: 'GROUP_AND_C2C_EVENT',
    OPEN_FORUMS_EVENT: 'FORUMS_EVENT',
};

/**
 * 将用户配置的 QQIntent 数组翻译成 SDK 接受的 Intent 数组，并去重。
 * @param input   用户在 YAML 中写的 intents
 * @param warn    输出警告的回调（通常是 this.logger.warn）
 */
export function mapIntents(
    input: QQIntent[] | undefined,
    warn: (msg: string) => void,
): SdkIntent[] | undefined {
    if (!input) return undefined;
    const out = new Set<SdkIntent>();
    const warned = new Set<string>();
    for (const v of input) {
        const mapped = LEGACY_TO_SDK[v];
        if (mapped) {
            if (!warned.has(v)) {
                warned.add(v);
                warn(`[QQ] intent '${v}' 已弃用，请改用 '${mapped}'`);
            }
            out.add(mapped);
        } else {
            out.add(v as SdkIntent);
        }
    }
    return [...out];
}