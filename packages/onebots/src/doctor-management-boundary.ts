import packageMetadata from "../package.json" with { type: "json" };
import type { DoctorCheck } from "./doctor-endpoint.js";

export interface DoctorManagementBoundaryOptions {
    health: DoctorCheck;
    identity: DoctorCheck;
    runtimeContract?: DoctorCheck;
    probe: () => Promise<DoctorCheck[]>;
    confirm: () => Promise<DoctorCheck>;
}

/** 只有公开探针先证明当前 OneBots 实例，并在管理诊断后仍能证明同一实例，才接受证据。 */
export async function probeDoctorManagementAfterIdentity(
    options: DoctorManagementBoundaryOptions,
): Promise<DoctorCheck[]> {
    const boundary = inspectDoctorManagementIdentity(options);
    if (boundary.level !== "ok") return [boundary];
    const managementChecks = await options.probe();
    const confirmation = inspectDoctorManagementConfirmation(boundary, await options.confirm());
    return [boundary, ...managementChecks, confirmation];
}

function inspectDoctorManagementIdentity(
    options: Omit<DoctorManagementBoundaryOptions, "probe">,
): DoctorCheck {
    if (options.health.level !== "ok") {
        return rejectedBoundary("health 未证明当前 OneBots CLI 的健康运行实例");
    }
    if (options.identity.level !== "ok" || !options.identity.identity) {
        return rejectedBoundary("health 与 ready 未证明来自同一运行实例");
    }
    if (options.identity.identity.application !== packageMetadata.name) {
        return rejectedBoundary(`在线应用不是 ${packageMetadata.name}`);
    }
    if (options.identity.identity.version !== packageMetadata.version) {
        return rejectedBoundary(
            `在线 OneBots ${options.identity.identity.version} 与当前 CLI ${packageMetadata.version} 不一致`,
        );
    }
    if (options.runtimeContract && options.runtimeContract.level !== "ok") {
        return rejectedBoundary("在线实例未证明采用当前受管服务启动契约");
    }
    return {
        name: "management-identity",
        level: "ok",
        message: "公开探针已证明当前 OneBots 实例，允许执行带凭据的管理诊断",
        identity: options.identity.identity,
    };
}

function rejectedBoundary(reason: string): DoctorCheck {
    return {
        name: "management-identity",
        level: "error",
        message: `${reason}；已跳过带凭据的管理诊断`,
    };
}

function inspectDoctorManagementConfirmation(
    initial: DoctorCheck,
    finalHealth: DoctorCheck,
): DoctorCheck {
    if (finalHealth.level !== "ok" || !finalHealth.identity || !initial.identity) {
        return {
            name: "management-instance",
            level: "error",
            message: `管理诊断完成后无法重新证明原实例仍持有端口：${finalHealth.message}`,
        };
    }
    const expected = initial.identity;
    const actual = finalHealth.identity;
    if (
        actual.application !== expected.application ||
        actual.version !== expected.version ||
        actual.instanceId !== expected.instanceId ||
        actual.runtimeContractId !== expected.runtimeContractId
    ) {
        return {
            name: "management-instance",
            level: "error",
            message: `管理诊断期间端口实例发生变化：开始为 ${formatIdentity(expected)}，结束为 ${formatIdentity(actual)}；拒绝接受跨实例拼接的管理证据`,
        };
    }
    return {
        name: "management-instance",
        level: "ok",
        message: `管理诊断前后均由 ${formatIdentity(actual)} 响应，管理证据属于同一运行实例`,
        identity: actual,
    };
}

function formatIdentity(identity: NonNullable<DoctorCheck["identity"]>): string {
    const contract = identity.runtimeContractId ? ` 契约 ${identity.runtimeContractId}` : "";
    return `${identity.application}@${identity.version} 实例 ${identity.instanceId}${contract}`;
}
