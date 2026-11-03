import { createLocalControlTransport } from "./client/local-control.js";
import { inspectMigrationManager } from "./service-migration-manager.js";

export interface ManagerReadiness {
    schemaVersion: 1;
    manager: { id: string; version: string; pid: number };
    admission: { schemaVersion: 1; state: string; reason: string };
    gateway: null;
}

/** 完整诊断不可用时仍可确认诊断 manager 身份；两个读取都失败仍是未知。 */
export async function inspectManagerServiceIdentity(
    workspace: string,
    inspect: typeof inspectMigrationManager = inspectMigrationManager,
    minimal: typeof inspectManagerReadiness = inspectManagerReadiness,
): Promise<ManagerReadiness["manager"]> {
    try {
        return (await inspect(workspace)).manager;
    } catch (error) {
        try {
            return (await minimal(workspace)).manager;
        } catch (minimalError) {
            throw new AggregateError([error, minimalError], "管理实例身份暂不可确认");
        }
    }
}

const plain = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === "object" && !Array.isArray(value);
const keys = (value: Record<string, unknown>, names: string[]) =>
    Object.keys(value).sort().join() === names.sort().join();

/** 只确认被 OS 托管的诊断 manager，不把缺失 gateway 推导为 stopped。 */
export async function inspectManagerReadiness(workspace: string): Promise<ManagerReadiness> {
    const value = await createLocalControlTransport(workspace).request<unknown>(
        "GET",
        "/api/control/manager-readiness",
    );
    if (
        !plain(value) ||
        !keys(value, ["schemaVersion", "manager", "admission", "gateway"]) ||
        value.schemaVersion !== 1 ||
        value.gateway !== null ||
        !plain(value.manager) ||
        !keys(value.manager, ["id", "version", "pid"]) ||
        typeof value.manager.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value.manager.id,
        ) ||
        typeof value.manager.version !== "string" ||
        !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
            value.manager.version,
        ) ||
        !Number.isSafeInteger(value.manager.pid) ||
        Number(value.manager.pid) < 1 ||
        !plain(value.admission) ||
        !keys(value.admission, ["schemaVersion", "state", "reason"]) ||
        value.admission.schemaVersion !== 1 ||
        ![
            "verified",
            "unbound",
            "authority-unavailable",
            "binding-mismatch",
            "registration-pending",
            "unsupported",
        ].includes(String(value.admission.state)) ||
        typeof value.admission.reason !== "string" ||
        !/^[A-Z_]{1,100}$/.test(value.admission.reason)
    )
        throw new Error("本机诊断管理实例就绪证明无效");
    return value as unknown as ManagerReadiness;
}
