import type { AuthenticationBindingPlan } from "../control/auth-binding.js";

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const HASH = /^[a-f0-9]{64}$/;
export const BINDING_FILE = "workspace-binding.json";
export const REGISTRATION_IMPACT =
    "首次登记将撤销全部旧管理会话及未兑换配对码，需要重新配对；业务账号会话和配置保持不变；本操作不启动管理服务或网关，下次启动沿用计划中的网关运行意图。";
export interface BindingContext {
    authorityId: string;
    workspaceId: string;
    bindingRevision: number;
    operationId: string;
}
export interface WorkspaceBinding extends BindingContext {
    schemaVersion: 1;
}
export function authenticationContext(binding: WorkspaceBinding): BindingContext {
    return {
        authorityId: binding.authorityId,
        workspaceId: binding.workspaceId,
        bindingRevision: binding.bindingRevision,
        operationId: binding.operationId,
    };
}
export interface PhysicalIdentity {
    provider: "posix" | "windows";
    volume: string;
    object: string;
}
export interface RegistrationPlan {
    schemaVersion: 1;
    impact: typeof REGISTRATION_IMPACT;
    requestId: string;
    workspaceId: string;
    workspace: string;
    authorityDirectory: string;
    authorityId: string;
    authorityExisted: boolean;
    rootIdentity: PhysicalIdentity;
    controlIdentity: PhysicalIdentity | null;
    kind: "new" | "legacy";
    receiptDigest: string | null;
    authDigest: string | null;
    gatewayDigest: string | null;
    desired: "running" | "stopped";
    digest: string;
}
export interface RegistrationRecord {
    schemaVersion: 1;
    status: "prepared" | "committed";
    plan: RegistrationPlan;
    identity: PhysicalIdentity;
    binding: WorkspaceBinding;
    authentication: AuthenticationBindingPlan;
    genesis: Record<string, string> | null;
}
export type AdmissionState =
    | "verified"
    | "unbound"
    | "authority-unavailable"
    | "binding-mismatch"
    | "registration-pending"
    | "unsupported";
export interface AdmissionInspection {
    schemaVersion: 1;
    state: AdmissionState;
    reason: string;
}
export interface AdmissionLease {
    inspection: AdmissionInspection;
    binding?: WorkspaceBinding;
    initialProcessState?: { receiptDigest: string; gatewayDigest: string };
    release(): void;
}
