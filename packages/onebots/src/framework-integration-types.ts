import type { ApplicationStage } from "@onebots/core";
import { deepFreeze } from "./framework-integration-utils.js";

export type FrameworkId = string;

export type FrameworkKind = "framework" | "distribution" | "sdk" | "bridge";
export type FrameworkProtocol = "onebot.v11" | "onebot.v12" | "satori.v1" | "milky.v1";
export type FrameworkTransport = "websocket" | "reverse-websocket" | "sse" | "webhook";
export type FrameworkVerificationLevel =
    | "documented"
    | "handshake"
    | "messages"
    | "actions"
    | "verified";

export interface FrameworkProfile {
    id: FrameworkId;
    displayName: string;
    kind: FrameworkKind;
    packageName: string | null;
    protocol: FrameworkProtocol;
    transport: FrameworkTransport;
    verification: FrameworkVerificationLevel;
    evidence?: FrameworkVerificationEvidence;
    distributionAudit?: DistributionCompatibilityAudit;
    upstream: string;
    defaultFrameworkOrigin: string | null;
    limitations: readonly string[];
    applicationStage?: Exclude<ApplicationStage, "planned">;
}

export interface DistributionCompatibilityAudit {
    sourceRevision: string;
    auditedAt: string;
    requiredActions: readonly string[];
    supportedActions: readonly string[];
    unsupportedActions: readonly string[];
    note: string;
}

export interface FrameworkVerificationEvidence {
    frameworkVersion: string;
    adapterVersion: string;
    lastVerifiedAt: string;
    command: string;
    checks: readonly string[];
}

export interface FrameworkConnectionRequest {
    framework: FrameworkId;
    account: string;
    onebotsOrigin?: string;
    frameworkOrigin?: string;
}

export interface FrameworkConnectionCheck {
    name: string;
    command?: string;
    expected: string;
}

export interface FrameworkConnectionPlan {
    schemaVersion: 1;
    framework: FrameworkProfile;
    account: { platform: string; accountId: string; key: string };
    protocol: FrameworkProtocol;
    transport: FrameworkTransport;
    endpoint: string;
    onebotsConfig: string;
    frameworkConfig: string;
    checks: FrameworkConnectionCheck[];
    limitations: string[];
}

export interface FrameworkIntegrationContext {
    profile: FrameworkProfile;
    onebotsEndpoint: string;
    frameworkOrigin: URL | null;
}

export interface FrameworkConfigRenderContext extends FrameworkIntegrationContext {
    endpoint: string;
}

export interface FrameworkIntegrationProvider {
    profile: FrameworkProfile;
    resolveEndpoint?: (context: FrameworkIntegrationContext) => string;
    renderFrameworkConfig: (context: FrameworkConfigRenderContext) => string;
}

export function defineFrameworkIntegration(
    provider: FrameworkIntegrationProvider,
): FrameworkIntegrationProvider {
    return provider;
}

/** 框架接入是独立于平台 Adapter 与出口 Protocol 的下游方案扩展。 */
export class FrameworkIntegrationRegistry {
    private static providers = new Map<string, FrameworkIntegrationProvider>();

    static register(provider: FrameworkIntegrationProvider): void {
        const id = provider.profile.id.trim();
        if (!id || id !== provider.profile.id || !/^[a-z0-9][a-z0-9-]*$/u.test(id)) {
            throw new TypeError(`框架集成 id 无效：${provider.profile.id}`);
        }
        const registered = this.providers.get(id);
        if (registered === provider) return;
        if (registered) throw new TypeError(`框架集成 ${id} 已由其他提供者注册`);
        this.providers.set(id, deepFreeze(provider));
    }

    static get(id: string): FrameworkIntegrationProvider | undefined {
        return this.providers.get(id);
    }

    static list(): readonly FrameworkIntegrationProvider[] {
        return [...this.providers.values()];
    }

    /** @internal 供动态扩展加载事务失败时完整回滚。 */
    static capture(): ReadonlyMap<string, FrameworkIntegrationProvider> {
        return new Map(this.providers);
    }

    /** @internal 只接受由 capture 产生的进程内快照。 */
    static restore(snapshot: ReadonlyMap<string, FrameworkIntegrationProvider>): void {
        this.providers = new Map(snapshot);
    }
}
