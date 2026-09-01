import type { AdapterInfo } from "./types.js";

/** 在账号运行态进入页面前验证最小闭合契约，避免畸形条目污染轮询快照。 */
export function parseAdapterInventory(value: unknown): AdapterInfo[] {
    if (!Array.isArray(value)) throw new Error("适配器运行态响应必须是数组");
    const platforms = new Set<string>();
    for (const [index, adapter] of value.entries()) {
        if (!isRecord(adapter)) throw new Error(`适配器运行态条目 #${index} 必须是对象`);
        const platform = nonEmptyString(adapter.platform);
        if (!platform) throw new Error(`适配器运行态条目 #${index} 缺少平台身份`);
        if (platforms.has(platform)) throw new Error(`适配器运行态包含重复平台: ${platform}`);
        platforms.add(platform);
        if (!Array.isArray(adapter.accounts)) {
            throw new Error(`适配器 ${platform} 缺少账号数组`);
        }
        const accountIds = new Set<string>();
        for (const account of adapter.accounts) {
            if (!isRecord(account)) throw new Error(`适配器 ${platform} 的账号条目必须是对象`);
            const accountId = nonEmptyString(account.uin);
            if (!accountId) throw new Error(`适配器 ${platform} 的账号缺少身份`);
            if (accountIds.has(accountId)) {
                throw new Error(`适配器 ${platform} 包含重复账号: ${accountId}`);
            }
            accountIds.add(accountId);
            if (account.platform !== platform) {
                throw new Error(`账号 ${platform}.${accountId} 的平台身份不一致`);
            }
            if (!Array.isArray(account.protocols)) {
                throw new Error(`账号 ${platform}.${accountId} 缺少协议生命周期数组`);
            }
        }
    }
    return value as AdapterInfo[];
}

function nonEmptyString(value: unknown): string | null {
    return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
