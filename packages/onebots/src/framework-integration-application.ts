import { defineApplication, type Protocol } from "@onebots/core";
import type { FrameworkProfile } from "./framework-integration-types.js";

export function createProfileApplication(profile: FrameworkProfile) {
    return defineApplication({
        name: profile.id,
        displayName: profile.displayName,
        description: `${profile.displayName} 的 ${profile.protocol} 运行时连接扩展。`,
        homepage: profile.upstream,
        stage: profile.applicationStage,
        createProtocolExtension(protocol: Protocol) {
            if (`${protocol.name}.${protocol.version}` !== profile.protocol) return undefined;
            const direction =
                profile.transport === "reverse-websocket"
                    ? ("onebots-connects" as const)
                    : ("onebots-listens" as const);
            const endpoint =
                direction === "onebots-listens"
                    ? protocol.path
                    : (profile.defaultFrameworkOrigin ?? "由目标框架配置监听地址");
            const actions =
                profile.distributionAudit?.requiredActions ??
                profile.evidence?.checks.filter(check => /^[a-z][a-z0-9_]+$/u.test(check)) ??
                [];
            return {
                capability: {
                    connections: [
                        {
                            id: `${profile.protocol}-${profile.transport}`,
                            transport: profile.transport,
                            direction,
                            endpoint,
                            description: `${profile.displayName} 使用 ${profile.protocol} 的 ${profile.transport} 连接。`,
                        },
                    ],
                    actions: [],
                    requiredActions: [...new Set(actions)],
                    unsupportedActions: [...(profile.distributionAudit?.unsupportedActions ?? [])],
                    routes: [],
                    limitations: [...profile.limitations],
                },
            };
        },
        unsupportedProtocol(protocol: Protocol) {
            return [
                `${profile.displayName} 当前固定方案使用 ${profile.protocol}，未验证 ${protocol.name}.${protocol.version}。`,
            ];
        },
    });
}
