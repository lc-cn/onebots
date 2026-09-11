import { managerUpgradeStatus } from "../service-upgrade-workspace.js";
import type { ManagerUpgradeIdentity } from "./service-upgrade-release.js";
import {
    readServiceMigrationPending,
    releaseServiceMigrationPending,
} from "../service-migration-workspace.js";

export function serviceMigrationStatus(workspace: string) {
    try {
        const pending = readServiceMigrationPending(workspace);
        const upgrade = managerUpgradeStatus(workspace);
        return {
            pending: Boolean(pending) || upgrade.pending,
            recoveryRequired: upgrade.recoveryRequired,
        };
    } catch {
        return { pending: true, recoveryRequired: true };
    }
}

/** 在鉴权之后调用；host在其整个生命周期持有工作区锁。 */
export async function handleServiceMigrationRequest(input: {
    workspace: string;
    ownershipAvailable?: boolean;
    pathname: string;
    method: string;
    local: boolean;
    body: () => Promise<unknown>;
    releaseUpgrade?: (body: unknown) => Promise<void>;
    upgradeIdentity?: () => ManagerUpgradeIdentity;
}) {
    if (input.pathname === "/api/control/service-upgrade/identity") {
        if (!input.local) return { status: 403, body: { message: "升级身份仅允许本机控制通道" } };
        if (input.method !== "GET") return { status: 405, body: { message: "不支持此方法" } };
        if (input.ownershipAvailable === false)
            return { status: 423, body: { message: "历史管理进程所有权不可确认" } };
        try {
            if (!input.upgradeIdentity) throw new Error();
            return { status: 200, body: input.upgradeIdentity() };
        } catch {
            return { status: 409, body: { message: "升级身份暂时无法核实" } };
        }
    }
    if (input.method === "POST" && input.ownershipAvailable === false)
        return { status: 423, body: { message: "历史管理进程所有权不可确认，暂时禁止修改" } };
    if (input.pathname === "/api/control/service-upgrade/release") {
        if (!input.local) return { status: 403, body: { message: "升级确认仅允许本机控制通道" } };
        if (input.method !== "POST") return { status: 405, body: { message: "不支持此方法" } };
        try {
            if (!input.releaseUpgrade) throw new Error();
            await input.releaseUpgrade(await input.body());
            return { status: 200, body: { released: true } };
        } catch {
            return { status: 409, body: { message: "升级确认结果未核实，请在本机对账" } };
        }
    }
    if (input.method === "POST" && managerUpgradeStatus(input.workspace).pending)
        return { status: 423, body: { message: "管理程序升级尚未确认，暂时禁止修改" } };
    if (input.pathname === "/api/control/service-migration/release") {
        if (!input.local) return { status: 403, body: { message: "迁移确认仅允许本机控制通道" } };
        if (input.method !== "POST") return { status: 405, body: { message: "不支持此方法" } };
        try {
            const body = await input.body();
            if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
            const value = body as Record<string, unknown>;
            if (Object.keys(value).length !== 1 || typeof value.operationId !== "string")
                throw new Error();
            releaseServiceMigrationPending(input.workspace, value.operationId);
            return { status: 200, body: { released: true } };
        } catch {
            return { status: 409, body: { message: "迁移确认结果未核实，请在本机对账" } };
        }
    }
    if (input.method === "POST" && serviceMigrationStatus(input.workspace).pending)
        return { status: 423, body: { message: "系统服务迁移尚未确认，暂时禁止修改" } };
    return null;
}
