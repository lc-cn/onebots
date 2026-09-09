import {
    parseManagerServiceRemovalSnapshot,
    type ManagerServiceRemoval,
} from "./manager-service-removal-snapshot.js";
import { createHash } from "node:crypto";
import { parseManagerServiceSpec, type ManagerServiceSpec } from "./manager-service-spec.js";
import {
    parseManagerServiceUpgrade,
    type ManagerServiceUpgrade,
} from "./manager-service-upgrade-record.js";
import {
    ServiceOperationStorage,
    canonicalServiceJson,
    closedServiceObject,
} from "./service-operation-storage.js";

export type ManagerServiceAction =
    | "start"
    | "stop"
    | "restart"
    | "install"
    | "uninstall"
    | "upgrade";
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
    | "rollback-stopping"
    | "rollback-writing"
    | "rollback-reloading"
    | "rollback-starting"
    | "rollback-verifying"
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
    upgrade?: ManagerServiceUpgrade;
}
export interface ManagerServicePreparation {
    id: string;
    action: ManagerServiceAction;
    desiredEnabled: boolean;
    spec: ManagerServiceSpec;
    removal?: ManagerServiceRemoval;
    upgrade?: ManagerServiceUpgrade;
}
const actions = ["start", "stop", "restart", "install", "uninstall", "upgrade"];
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
    "rollback-stopping",
    "rollback-writing",
    "rollback-reloading",
    "rollback-starting",
    "rollback-verifying",
    "completed",
];
const ID = /^[A-Za-z0-9_-]{1,128}$/;
const upgradePhases: ManagerServicePhase[] = [
    "prepared",
    "stopping",
    "writing",
    "restoring-enablement",
    "starting",
    "verifying",
    "releasing",
    "completed",
];
const rollbackPhases: ManagerServicePhase[] = [
    "rollback-stopping",
    "rollback-writing",
    "rollback-reloading",
    "rollback-starting",
    "rollback-verifying",
    "completed",
];
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
    /** 调用方持服务锁；只读取精确目标，绝不放宽其他操作的恢复门禁。 */
    recoverable(id: string): ManagerServiceRecord {
        try {
            if (this.corrupted || typeof id !== "string" || !ID.test(id)) throw failure();
            const names = this.storage.list().sort();
            let target: ManagerServiceRecord | undefined;
            for (const name of names) {
                const record = this.read(name.slice(0, -5));
                if (record.id === id) target = record;
                else if (!finished(record)) throw failure();
            }
            if (
                !target ||
                canonicalServiceJson(names) !== canonicalServiceJson(this.storage.list().sort())
            )
                throw failure();
            return target;
        } catch {
            throw failure();
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
                ...(Object.hasOwn(input, "upgrade") ? ["upgrade"] : []),
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
                ...(Object.hasOwn(value, "upgrade") ? { upgrade: value.upgrade } : {}),
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
                    canonicalServiceJson(previous.removal ?? null) ||
                canonicalServiceJson(record.upgrade ?? null) !==
                    canonicalServiceJson(previous.upgrade ?? null)
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
            if (record.action === "upgrade" && record.phase !== previous.phase) {
                const rollbackStart =
                    record.phase === "rollback-stopping" &&
                    previous.status === "interrupted" &&
                    previous.recoveryRequired &&
                    ["restoring-enablement", "starting", "verifying"].includes(previous.phase);
                const previousRollbackIndex = rollbackPhases.indexOf(previous.phase);
                const rollbackAdvance =
                    previousRollbackIndex >= 0 &&
                    rollbackPhases.indexOf(record.phase) === previousRollbackIndex + 1;
                const sequence = upgradePhases.filter(
                    phase =>
                        phase !== "starting" || record.upgrade?.snapshot.initial.processId !== null,
                );
                const previousUpgradeIndex = sequence.indexOf(previous.phase);
                const upgradeAdvance =
                    previousUpgradeIndex >= 0 &&
                    sequence.indexOf(record.phase) === previousUpgradeIndex + 1;
                if (!rollbackStart && !rollbackAdvance && !upgradeAdvance) throw failure();
            }
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
        ...(input && typeof input === "object" && Object.hasOwn(input, "upgrade")
            ? ["upgrade"]
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
    const hasUpgrade = Object.hasOwn(value, "upgrade");
    if ((value.action === "upgrade") !== hasUpgrade) throw failure();
    if (hasUpgrade) {
        const upgrade = parseManagerServiceUpgrade(value.upgrade, spec, value.desiredEnabled);
        value.upgrade = upgrade;
        if (
            ![...upgradePhases, ...rollbackPhases].includes(value.phase as ManagerServicePhase) ||
            (value.phase === "starting" && upgrade.snapshot.initial.processId === null)
        )
            throw failure();
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
