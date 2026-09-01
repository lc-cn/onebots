import packageMetadata from "../package.json" with { type: "json" };
import type { DoctorCheck } from "./doctor-endpoint.js";

export interface DoctorManagementBoundaryOptions {
    health: DoctorCheck;
    identity: DoctorCheck;
    runtimeContract?: DoctorCheck;
    probe: () => Promise<DoctorCheck[]>;
}

/** 只有公开探针先证明当前 OneBots 实例后，才允许向配置端口发送管理凭据。 */
export async function probeDoctorManagementAfterIdentity(
    options: DoctorManagementBoundaryOptions,
): Promise<DoctorCheck[]> {
    const boundary = inspectDoctorManagementIdentity(options);
    if (boundary.level !== "ok") return [boundary];
    return [boundary, ...(await options.probe())];
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
