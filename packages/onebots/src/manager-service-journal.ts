import {
    parseManagerServiceRemovalSnapshot,
    type ManagerServiceRemoval,
} from "./manager-service-removal-snapshot.js";
import { createHash } from "node:crypto";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import {
    ServiceOperationStorage,
    canonicalServiceJson,
    closedServiceObject,
} from "./service-operation-storage.js";

export type ManagerServiceAction = "start" | "stop" | "restart" | "install" | "uninstall";
export type ManagerServicePhase =
    | "prepared"
    | "stopping"
    | "restoring-enablement"
    | "starting"
    | "writing"
    | "removing-definition"
    | "unregistering"
    | "removing-metadata"
    | "removing"
    | "verifying"
    | "releasing"
    | "completed";
export interface ManagerServiceRecord {
    schemaVersion: 1;
    id: string;
    action: ManagerServiceAction;
    phase: ManagerServicePhase;
    status: "running" | "succeeded" | "failed" | "interrupted";
    recoveryRequired: boolean;
    desiredEnabled: boolean;
    managerSpec: ManagerServiceSpec;
    managerSpecDigest: string;
    removal?: ManagerServiceRemoval;
}
export interface ManagerServicePreparation {
    id: string;
    action: ManagerServiceAction;
    desiredEnabled: boolean;
    spec: ManagerServiceSpec;
    removal?: ManagerServiceRemoval;
}
const actions = ["start", "stop", "restart", "install", "uninstall"];
const phases = [
    "prepared",
    "stopping",
    "restoring-enablement",
    "starting",
    "writing",
    "removing",
    "removing-definition",
    "unregistering",
    "removing-metadata",
    "verifying",
    "releasing",
    "completed",
];
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const failure = () => new Error("管理服务操作记录未确认或已损坏，禁止继续操作");

/**
 * 调用方持服务级锁；先prepare/save阶段意图成功，再执行对应OS动作。
 * stop保留desiredEnabled及gateway desired由controller执行，本日志不触碰业务配置。
 * spec是无业务秘密的闭合管理契约；uninstall后仍能确定原工作区和文件归属。
 */
export class FileManagerServiceJournal {
    private readonly storage: ServiceOperationStorage;
    private corrupted = false;
    constructor(directory: string) {
        this.storage = new ServiceOperationStorage(directory);
        try {
            for (const name of this.storage.list()) {
                const record = this.read(name.slice(0, -5));
                if (record.status === "running")
                    this.save({ ...record, status: "interrupted", recoveryRequired: true });
            }
        } catch {
            this.corrupted = true; /* 保留现场，冷启动不执行任何外部effects。 */
        }
    }
    health(): { recoveryRequired: boolean } {
        try {
            return {
                recoveryRequired:
                    this.corrupted ||
                    this.storage.list().some(name => !finished(this.read(name.slice(0, -5)))),
            };
        } catch {
            return { recoveryRequired: true };
        }
    }
    prepare(input: ManagerServicePreparation): ManagerServiceRecord {
        try {
            const value = closedServiceObject(input, [
                "id",
                "action",
                "desiredEnabled",
                "spec",
                ...(Object.hasOwn(input, "removal") ? ["removal"] : []),
            ]);
            const spec = parseManagerServiceSpec(value.spec);
            const record = parseManagerServiceRecord({
                schemaVersion: 1,
                id: value.id,
                action: value.action,
                desiredEnabled: value.desiredEnabled,
                managerSpec: spec,
                managerSpecDigest: digest(spec),
                ...(Object.hasOwn(value, "removal") ? { removal: value.removal } : {}),
                phase: "prepared",
                status: "running",
                recoveryRequired: false,
            });
            if (this.health().recoveryRequired || this.storage.has(`${record.id}.json`))
                throw failure();
            this.storage.write(`${record.id}.json`, record, true);
            return this.read(record.id);
        } catch {
            throw failure();
        }
    }
    read(id: string): ManagerServiceRecord {
        try {
            if (typeof id !== "string" || !ID.test(id)) throw failure();
            const record = parseManagerServiceRecord(this.storage.read(`${id}.json`));
            if (record.id !== id) throw failure();
            return record;
        } catch {
            throw failure();
        }
    }
    save(input: ManagerServiceRecord): void {
        try {
            const record = parseManagerServiceRecord(input);
            const previous = this.read(record.id);
            if (
                record.action !== previous.action ||
                record.desiredEnabled !== previous.desiredEnabled ||
                record.managerSpecDigest !== previous.managerSpecDigest ||
                canonicalServiceJson(record.removal ?? null) !==
                    canonicalServiceJson(previous.removal ?? null)
            )
                throw failure();
            if (
                finished(previous) &&
                canonicalServiceJson(record) !== canonicalServiceJson(previous) &&
                !(
                    record.status === "interrupted" &&
                    record.recoveryRequired &&
                    record.phase === previous.phase
                )
            )
                throw failure();
            if (previous.status === "interrupted" && record.status === "running") throw failure();
            this.storage.write(`${record.id}.json`, record);
        } catch {
            throw failure();
        }
    }
}
export function parseManagerServiceRecord(input: unknown): ManagerServiceRecord {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "id",
        "action",
        "phase",
        "status",
        "recoveryRequired",
        "desiredEnabled",
        "managerSpec",
        "managerSpecDigest",
        ...(input && typeof input === "object" && Object.hasOwn(input, "removal")
            ? ["removal"]
            : []),
    ]);
    const spec = parseManagerServiceSpec(value.managerSpec);
    if (
        value.schemaVersion !== 1 ||
        typeof value.id !== "string" ||
        !ID.test(value.id) ||
        typeof value.action !== "string" ||
        !actions.includes(value.action) ||
        typeof value.phase !== "string" ||
        !phases.includes(value.phase) ||
        typeof value.status !== "string" ||
        !["running", "succeeded", "failed", "interrupted"].includes(value.status) ||
        typeof value.recoveryRequired !== "boolean" ||
        typeof value.desiredEnabled !== "boolean" ||
        value.managerSpecDigest !== digest(spec)
    )
        throw failure();
    if (value.status === "interrupted" && !value.recoveryRequired) throw failure();
    if (value.status === "succeeded" && (value.phase !== "completed" || value.recoveryRequired))
        throw failure();
    if (value.status === "failed" && !value.recoveryRequired && value.phase !== "completed")
        throw failure();
    const hasRemoval = Object.hasOwn(value, "removal");
    if ((value.action === "uninstall") !== hasRemoval) throw failure();
    if (hasRemoval) {
        value.removal = parseManagerServiceRemovalSnapshot(value.removal);
        if (value.desiredEnabled !== false) throw failure();
    }
    if (
        ["removing-definition", "unregistering", "removing-metadata"].includes(
            String(value.phase),
        ) &&
        value.action !== "uninstall"
    )
        throw failure();
    return { ...value, managerSpec: spec } as unknown as ManagerServiceRecord;
}
function finished(record: ManagerServiceRecord): boolean {
    return !record.recoveryRequired && ["succeeded", "failed"].includes(record.status);
}
function digest(spec: ManagerServiceSpec): string {
    return createHash("sha256").update(canonicalServiceJson(spec)).digest("hex");
}
