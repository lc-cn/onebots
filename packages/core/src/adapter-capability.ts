import { ValidationError } from "./errors.js";
import type { CommonTypes } from "./types.js";

/**
 * 适配器能力清单版本。
 *
 * 清单是协议、管理端、文档和契约测试共同消费的稳定 Seam。版本号只在清单
 * 结构本身发生变化时递增，与具体适配器包版本无关。
 */
export const ADAPTER_CAPABILITY_MANIFEST_VERSION = 1 as const;

export type CapabilitySupport = "native" | "emulated" | "unsupported";
export type CapabilityAvailability = "always" | "permission" | "context";
export type CapabilityDirection = "send" | "receive" | "both";

export interface CapabilityDescriptor {
    /** native 为平台原生能力；emulated 表示 OneBots 做了有损或组合实现。 */
    support: CapabilitySupport;
    /** 能力是否依赖额外权限或当前会话上下文。 */
    availability?: CapabilityAvailability;
    scenes?: readonly CommonTypes.Scene[];
    permissions?: readonly string[];
    note?: string;
}

export interface SegmentCapabilityDescriptor extends CapabilityDescriptor {
    direction: CapabilityDirection;
}

export interface TransportCapabilityDescriptor extends CapabilityDescriptor {
    mode: "webhook" | "websocket" | "reverse_websocket" | "polling" | "sse" | "native";
}

export interface AdapterCapabilityManifest {
    version: typeof ADAPTER_CAPABILITY_MANIFEST_VERSION;
    actions: Readonly<Record<string, CapabilityDescriptor>>;
    events: Readonly<Record<string, CapabilityDescriptor>>;
    segments: Readonly<Record<string, SegmentCapabilityDescriptor>>;
    transports: Readonly<Record<string, TransportCapabilityDescriptor>>;
}

export type AdapterCapabilityDefinition = Omit<AdapterCapabilityManifest, "version">;

const EMPTY_RECORD = Object.freeze({});

export const EMPTY_ADAPTER_CAPABILITIES: AdapterCapabilityManifest = Object.freeze({
    version: ADAPTER_CAPABILITY_MANIFEST_VERSION,
    actions: EMPTY_RECORD,
    events: EMPTY_RECORD,
    segments: EMPTY_RECORD,
    transports: EMPTY_RECORD,
});

/**
 * 定义并校验适配器能力清单。
 *
 * 适配器应导出一个清单常量，并同时传给 Adapter 构造器和 AdapterRegistry。
 * 这样运行时查询、Web 展示与包元数据不会产生两套容易漂移的声明。
 */
export function defineAdapterCapabilities(
    definition: AdapterCapabilityDefinition,
): AdapterCapabilityManifest {
    const manifest: AdapterCapabilityManifest = {
        version: ADAPTER_CAPABILITY_MANIFEST_VERSION,
        actions: freezeDescriptors(definition.actions),
        events: freezeDescriptors(definition.events),
        segments: freezeDescriptors(definition.segments),
        transports: freezeDescriptors(definition.transports),
    };
    assertAdapterCapabilities(manifest);
    return Object.freeze(manifest);
}

/** 返回原生或模拟实现的动作；明确标为 unsupported 的动作不会暴露给调用方。 */
export function listSupportedActions(manifest: AdapterCapabilityManifest): string[] {
    return Object.entries(manifest.actions)
        .filter(([, descriptor]) => descriptor.support !== "unsupported")
        .map(([name]) => name)
        .sort();
}

/**
 * 契约测试与注册阶段共用的清单断言。
 * 保持为无测试框架依赖的函数，使所有适配器都能直接复用。
 */
export function assertAdapterCapabilities(manifest: AdapterCapabilityManifest): void {
    if (manifest.version !== ADAPTER_CAPABILITY_MANIFEST_VERSION) {
        throw new ValidationError(`不支持的适配器能力清单版本: ${manifest.version}`);
    }

    validateDescriptorMap("actions", manifest.actions);
    validateDescriptorMap("events", manifest.events);
    validateDescriptorMap("segments", manifest.segments);
    validateDescriptorMap("transports", manifest.transports);
}

export interface AdapterCapabilityProvider {
    describeCapabilities(accountId?: string): AdapterCapabilityManifest;
    getSupportedActions(accountId: string): Promise<string[]>;
    /** 判断动作是否由具体适配器实现，而不是落到 Adapter 基类的未支持实现。 */
    isActionImplemented?(action: string): boolean;
}

/**
 * Adapter 契约测试的最小入口：校验清单结构以及查询结果是否来自同一份声明。
 * 平台测试只需再验证清单中声明为 supported 的动作和事件确实可执行/可投影。
 */
export async function assertAdapterCapabilityContract(
    adapter: AdapterCapabilityProvider,
    accountId = "contract-test",
): Promise<void> {
    const manifest = adapter.describeCapabilities(accountId);
    assertAdapterCapabilities(manifest);
    const expected = listSupportedActions(manifest);
    const actual = [...(await adapter.getSupportedActions(accountId))].sort();
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        throw new ValidationError(
            `适配器 getSupportedActions 与能力清单不一致: expected ${expected.join(", ")}; actual ${actual.join(", ")}`,
        );
    }
    assertSupportedActionsImplemented(adapter, manifest);
}

/** 校验每个已声明支持的动作都有实际实现，防止能力清单与运行时漂移。 */
export function assertSupportedActionsImplemented(
    adapter: AdapterCapabilityProvider,
    manifest = adapter.describeCapabilities(),
): void {
    if (!adapter.isActionImplemented) return;

    const missing = listSupportedActions(manifest).filter(
        action => !adapter.isActionImplemented?.(action),
    );
    if (missing.length > 0) {
        throw new ValidationError(`适配器能力清单声明了未实现动作: ${missing.join(", ")}`);
    }
}

/** 将协议层使用的 snake_case 动作名转换为 Adapter 的 camelCase 方法名。 */
export function adapterActionMethodName(action: string): string {
    return action.replace(/_([a-z0-9])/g, (_, character: string) => character.toUpperCase());
}

function freezeDescriptors<T extends CapabilityDescriptor>(
    descriptors: Readonly<Record<string, T>>,
): Readonly<Record<string, T>> {
    const entries = Object.entries(descriptors).map(([name, descriptor]) => [
        name,
        Object.freeze({
            ...descriptor,
            scenes: descriptor.scenes ? Object.freeze([...descriptor.scenes]) : undefined,
            permissions: descriptor.permissions
                ? Object.freeze([...descriptor.permissions])
                : undefined,
        }),
    ]);
    return Object.freeze(Object.fromEntries(entries));
}

function validateDescriptorMap(
    category: keyof Pick<
        AdapterCapabilityManifest,
        "actions" | "events" | "segments" | "transports"
    >,
    descriptors: Readonly<Record<string, CapabilityDescriptor>>,
): void {
    for (const [name, descriptor] of Object.entries(descriptors)) {
        if (!name.trim()) {
            throw new ValidationError(`适配器能力清单 ${category} 包含空名称`);
        }
        if (!(["native", "emulated", "unsupported"] as const).includes(descriptor.support)) {
            throw new ValidationError(`适配器能力 ${category}.${name} 的 support 无效`);
        }
        if (descriptor.availability === "permission" && !descriptor.permissions?.length) {
            throw new ValidationError(
                `适配器能力 ${category}.${name} 依赖权限，但未声明 permissions`,
            );
        }
    }
}
