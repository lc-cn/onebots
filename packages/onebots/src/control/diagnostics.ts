import type { ServerResponse } from "node:http";
import { jsonResponse } from "./http-utils.js";
import type { GatewayControllerState } from "./gateway-controller.js";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ControlDiagnostics } from "@onebots/core/control";
import { ConfigurationFile } from "../configuration/configuration-file.js";

interface DiagnosticStatus {
    manager: ControlDiagnostics["manager"];
    gateway: { actual: string; desired: string; recoveryRequired: boolean };
    configuration: { recoveryRequired: boolean };
    generation: { active: { id: string } | null; recoveryRequired: boolean };
    processOwnership: { available: boolean };
    serviceMigration: { pending: boolean; recoveryRequired: boolean };
}
/** 仅使用既有实例状态及安全文件读取，不加载插件、刷新schema或创建任何存储。 */
export function inspectControlDiagnostics(
    workspace: string,
    status: DiagnosticStatus,
    address: AddressInfo | string | null,
): ControlDiagnostics {
    let state: ControlDiagnostics["configuration"]["state"] = "unavailable";
    try {
        state = new ConfigurationFile(path.join(workspace, "config.yaml")).inspect().state;
    } catch {
        /* 读失败与坏YAML区分，绝不回传文件路径或异常原文。 */
    }
    const { actual, desired, recoveryRequired } = status.gateway;
    if (
        !["starting", "running", "stopping", "stopped", "failed"].includes(actual) ||
        !["running", "stopped"].includes(desired)
    )
        throw new Error("管理诊断状态不可读取");
    return {
        schemaVersion: 1,
        manager: {
            id: status.manager.id,
            pid: status.manager.pid,
            version: status.manager.version,
        },
        management:
            address && typeof address !== "string"
                ? { host: address.address, port: address.port }
                : null,
        gateway: {
            actual: actual as ControlDiagnostics["gateway"]["actual"],
            desired: desired as ControlDiagnostics["gateway"]["desired"],
            recoveryRequired,
        },
        configuration: { state, recoveryRequired: status.configuration.recoveryRequired },
        generation: {
            activeId: status.generation.active?.id ?? null,
            recoveryRequired: status.generation.recoveryRequired,
        },
        processOwnership: { available: status.processOwnership.available },
        serviceMigration: {
            pending: status.serviceMigration.pending,
            recoveryRequired: status.serviceMigration.recoveryRequired,
        },
    };
}

export function gatewayDiagnosticStatus(state: GatewayControllerState, unavailable: boolean) {
    return unavailable
        ? {
              ...state,
              actual: "failed" as const,
              recoveryRequired: true,
              error: "控制状态不可读取，请检查本地工作区",
          }
        : state;
}
export function respondControlSnapshot(
    response: ServerResponse,
    pathname: string,
    workspace: string,
    status: DiagnosticStatus,
    address: AddressInfo | string | null,
) {
    jsonResponse(
        response,
        200,
        pathname.endsWith("/diagnostics")
            ? inspectControlDiagnostics(workspace, status, address)
            : status,
    );
}
