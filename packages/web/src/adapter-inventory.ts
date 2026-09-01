import type { AdapterCapabilityManifest } from "@onebots/core";
import type { AdapterInfo } from "./types.js";
import { assertCapabilityManifest } from "./components/capability-presentation.js";

const ADAPTER_FIELDS = new Set([
    "platform",
    "displayName",
    "description",
    "icon",
    "capabilities",
    "capabilityDeclared",
    "capabilitySource",
    "capabilityPackageVersion",
    "capabilityStatus",
    "accountLifecycleControl",
    "accounts",
    "accountCapabilities",
    "accountCapabilityErrors",
]);
const ACCOUNT_FIELDS = new Set([
    "uin",
    "status",
    "avatar",
    "platform",
    "nickname",
    "dependency",
    "startupTimeoutSeconds",
    "urls",
    "protocols",
]);
const PROTOCOL_FIELDS = new Set(["name", "version", "path", "lifecycleStatus"]);
const ACCOUNT_STATUSES = ["pending", "online", "offline"] as const;
const PROTOCOL_STATUSES = [
    "pending",
    "starting",
    "ready",
    "stopping",
    "stopped",
    "failed",
] as const;

/**
 * 原子验证账号运行态、默认能力、账号覆写与生命周期证据。
 * 任一条目不闭合时整份快照都不可采用，避免能力面板和账号操作消费半可信对象。
 */
export function parseAdapterInventory(value: unknown): AdapterInfo[] {
    if (!Array.isArray(value)) throw new Error("适配器运行态响应必须是数组");
    const platforms = new Set<string>();
    for (const [index, adapter] of value.entries()) parseAdapter(adapter, index, platforms);
    return value as AdapterInfo[];
}

function parseAdapter(value: unknown, index: number, platforms: Set<string>): void {
    if (!isRecord(value)) throw new Error(`适配器运行态条目 #${index} 必须是对象`);
    assertKnownFields(value, ADAPTER_FIELDS, `适配器运行态条目 #${index}`);
    const platform = requireIdentity(value.platform, `适配器运行态条目 #${index} 缺少平台身份`);
    if (platforms.has(platform)) throw new Error(`适配器运行态包含重复平台: ${platform}`);
    platforms.add(platform);
    if (
        !isNonEmptyText(value.displayName) ||
        typeof value.description !== "string" ||
        typeof value.icon !== "string"
    ) {
        throw new Error(`适配器 ${platform} 的展示元数据无效`);
    }
    assertRuntimeCapabilityEvidence(value, platform);
    if (
        !isRecord(value.accountLifecycleControl) ||
        Object.keys(value.accountLifecycleControl).some(
            field => !["online", "offline"].includes(field),
        ) ||
        typeof value.accountLifecycleControl.online !== "boolean" ||
        typeof value.accountLifecycleControl.offline !== "boolean"
    ) {
        throw new Error(`适配器 ${platform} 的账号生命周期控制证据无效`);
    }
    if (!Array.isArray(value.accounts)) throw new Error(`适配器 ${platform} 缺少账号数组`);
    const accountIds = new Set<string>();
    for (const account of value.accounts) parseAccount(account, platform, accountIds);
    parseAccountCapabilityEvidence(value, platform, accountIds);
}

function assertRuntimeCapabilityEvidence(adapter: Record<string, unknown>, platform: string): void {
    try {
        assertCapabilityManifest(adapter.capabilities);
    } catch {
        throw new Error(`适配器 ${platform} 的默认能力清单无效`);
    }
    if (
        typeof adapter.capabilityDeclared !== "boolean" ||
        adapter.capabilitySource !== "runtime" ||
        !isOneOf(adapter.capabilityStatus, ["verified", "unknown"] as const) ||
        !isNullableNonEmptyText(adapter.capabilityPackageVersion)
    ) {
        throw new Error(`适配器 ${platform} 的默认能力证据无效`);
    }
    if (
        adapter.capabilityStatus !== (adapter.capabilityDeclared ? "verified" : "unknown") ||
        (!adapter.capabilityDeclared && hasCapabilityEntries(adapter.capabilities))
    ) {
        throw new Error(`适配器 ${platform} 的默认能力结论与清单矛盾`);
    }
}

function parseAccount(value: unknown, platform: string, accountIds: Set<string>): void {
    if (!isRecord(value)) throw new Error(`适配器 ${platform} 的账号条目必须是对象`);
    assertKnownFields(value, ACCOUNT_FIELDS, `适配器 ${platform} 的账号条目`);
    const accountId = requireIdentity(value.uin, `适配器 ${platform} 的账号缺少身份`);
    if (accountIds.has(accountId)) throw new Error(`适配器 ${platform} 包含重复账号: ${accountId}`);
    accountIds.add(accountId);
    if (value.platform !== platform) {
        throw new Error(`账号 ${platform}.${accountId} 的平台身份不一致`);
    }
    if (
        !isOneOf(value.status, ACCOUNT_STATUSES) ||
        typeof value.avatar !== "string" ||
        typeof value.nickname !== "string" ||
        (value.dependency !== undefined && typeof value.dependency !== "string") ||
        !isPositiveFiniteNumber(value.startupTimeoutSeconds) ||
        !Array.isArray(value.urls) ||
        !value.urls.every(isNonEmptyText) ||
        !Array.isArray(value.protocols)
    ) {
        throw new Error(`账号 ${platform}.${accountId} 的运行态摘要无效`);
    }
    const protocolKeys = new Set<string>();
    const protocolPaths: string[] = [];
    for (const protocol of value.protocols) {
        if (!isRecord(protocol)) {
            throw new Error(`账号 ${platform}.${accountId} 的协议生命周期条目无效`);
        }
        assertKnownFields(protocol, PROTOCOL_FIELDS, `账号 ${platform}.${accountId} 的协议条目`);
        if (
            !isNonEmptyText(protocol.name) ||
            !isNonEmptyText(protocol.version) ||
            !isNonEmptyText(protocol.path) ||
            !isOneOf(protocol.lifecycleStatus, PROTOCOL_STATUSES)
        ) {
            throw new Error(`账号 ${platform}.${accountId} 的协议生命周期条目无效`);
        }
        const key = `${protocol.name}.${protocol.version}`;
        if (protocolKeys.has(key)) {
            throw new Error(`账号 ${platform}.${accountId} 包含重复协议: ${key}`);
        }
        protocolKeys.add(key);
        protocolPaths.push(protocol.path);
    }
    if (!sameStringArray(value.urls, protocolPaths)) {
        throw new Error(`账号 ${platform}.${accountId} 的协议 URL 与生命周期列表矛盾`);
    }
}

function parseAccountCapabilityEvidence(
    adapter: Record<string, unknown>,
    platform: string,
    accountIds: Set<string>,
): void {
    if (!isRecord(adapter.accountCapabilities) || !isRecord(adapter.accountCapabilityErrors)) {
        throw new Error(`适配器 ${platform} 缺少闭合的账号能力证据`);
    }
    const defaultCapabilities = adapter.capabilities as AdapterCapabilityManifest;
    for (const [accountId, manifest] of Object.entries(adapter.accountCapabilities)) {
        assertKnownAccount(accountId, platform, accountIds);
        try {
            assertCapabilityManifest(manifest);
        } catch {
            throw new Error(`账号 ${platform}.${accountId} 的专属能力清单无效`);
        }
        if (dataEquals(manifest, defaultCapabilities)) {
            throw new Error(`账号 ${platform}.${accountId} 的能力覆写与默认清单相同`);
        }
    }
    for (const [accountId, error] of Object.entries(adapter.accountCapabilityErrors)) {
        assertKnownAccount(accountId, platform, accountIds);
        if (Object.hasOwn(adapter.accountCapabilities, accountId)) {
            throw new Error(`账号 ${platform}.${accountId} 同时携带能力覆写与失败诊断`);
        }
        if (
            !isRecord(error) ||
            Object.keys(error).some(field => !["code", "message"].includes(field)) ||
            error.code !== "capability_unavailable" ||
            !isNonEmptyText(error.message) ||
            error.message.length > 500
        ) {
            throw new Error(`账号 ${platform}.${accountId} 的能力失败诊断无效`);
        }
    }
}

function assertKnownAccount(accountId: string, platform: string, accountIds: Set<string>): void {
    if (!accountIds.has(accountId)) {
        throw new Error(`适配器 ${platform} 为未知账号 ${accountId} 发布能力证据`);
    }
}

function assertKnownFields(
    value: Record<string, unknown>,
    allowed: ReadonlySet<string>,
    label: string,
): void {
    const unknown = Object.keys(value).find(field => !allowed.has(field));
    if (unknown) throw new Error(`${label} 包含未知字段 ${unknown}`);
}

function hasCapabilityEntries(manifest: AdapterCapabilityManifest): boolean {
    return [manifest.actions, manifest.events, manifest.segments, manifest.transports].some(
        category => Object.keys(category).length > 0,
    );
}

function dataEquals(left: unknown, right: unknown): boolean {
    if (Object.is(left, right)) return true;
    if (Array.isArray(left) || Array.isArray(right)) {
        return (
            Array.isArray(left) &&
            Array.isArray(right) &&
            left.length === right.length &&
            left.every((item, index) => dataEquals(item, right[index]))
        );
    }
    if (!isRecord(left) || !isRecord(right)) return false;
    const leftKeys = Object.keys(left).sort();
    const rightKeys = Object.keys(right).sort();
    return (
        sameStringArray(leftKeys, rightKeys) &&
        leftKeys.every(key => dataEquals(left[key], right[key]))
    );
}

function sameStringArray(left: readonly unknown[], right: readonly string[]): boolean {
    return left.length === right.length && left.every((item, index) => item === right[index]);
}

function requireIdentity(value: unknown, message: string): string {
    if (!isNonEmptyText(value) || value !== value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) {
        throw new Error(message);
    }
    return value;
}

function isPositiveFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isNullableNonEmptyText(value: unknown): value is string | null {
    return value === null || isNonEmptyText(value);
}

function isNonEmptyText(value: unknown): value is string {
    return typeof value === "string" && Boolean(value.trim());
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(value: unknown, values: readonly T[]): value is T {
    return typeof value === "string" && values.includes(value as T);
}
