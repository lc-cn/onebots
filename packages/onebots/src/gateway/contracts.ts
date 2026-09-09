/** 私有父子 IPC 契约；不得作为公共 HTTP 控制接口暴露。 */
export const GATEWAY_PROTOCOL_VERSION = 1 as const;

export interface GatewayIdentity {
    protocolVersion: typeof GATEWAY_PROTOCOL_VERSION;
    controlInstanceId: string;
    gatewayInstanceId: string;
}

export interface GatewayStartMessage extends GatewayIdentity {
    type: "gateway.start";
    configVersion: string;
    dependencyVersion: string;
    configPath: string;
    workspacePath: string;
    selection: { adapters: string[]; protocols: string[]; applications: string[] };
}

export interface GatewayStopMessage extends GatewayIdentity {
    type: "gateway.stop";
    timeoutMs?: number;
}

export interface GatewayReadyMessage extends GatewayIdentity {
    /** 私有管理传输已可用；不代表全部账号在线或协议已完成启动。 */
    type: "gateway.ready";
    capabilities?: Array<"mcp" | "send" | "message-debug">;
    configVersion: string;
    dependencyVersion: string;
    address: { host: "127.0.0.1"; port: number };
}

export interface GatewayFailedMessage extends GatewayIdentity {
    type: "gateway.failed";
    code: "START_FAILED" | "STOP_FAILED" | "INVALID_MESSAGE";
    message: string;
}

export type GatewayParentMessage = GatewayStartMessage | GatewayStopMessage;
export type GatewayChildMessage = GatewayReadyMessage | GatewayFailedMessage;

export function isGatewayParentMessage(value: unknown): value is GatewayParentMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Record<string, unknown>;
    if (message.protocolVersion !== GATEWAY_PROTOCOL_VERSION) return false;
    if (![message.controlInstanceId, message.gatewayInstanceId].every(isIdentifier)) return false;
    if (message.type === "gateway.stop") {
        return (
            message.timeoutMs === undefined ||
            (typeof message.timeoutMs === "number" &&
                Number.isFinite(message.timeoutMs) &&
                message.timeoutMs > 0)
        );
    }
    if (message.type !== "gateway.start") return false;
    if (
        ![
            message.configVersion,
            message.dependencyVersion,
            message.configPath,
            message.workspacePath,
        ].every(isIdentifier)
    )
        return false;
    const selection = message.selection as Record<string, unknown> | undefined;
    return (
        !!selection &&
        typeof selection === "object" &&
        [selection.adapters, selection.protocols, selection.applications].every(
            items => Array.isArray(items) && items.every(isIdentifier),
        )
    );
}

function isIdentifier(value: unknown): value is string {
    return typeof value === "string" && value.length > 0 && value.length <= 4096;
}
