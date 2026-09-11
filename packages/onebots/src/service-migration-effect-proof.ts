import { createHash } from "node:crypto";
import type {
    ServiceMigrationRecord,
    ServiceMigrationEffectProof,
    ServiceMigrationReloadedProof,
    ServiceMigrationReloadOldReceipt,
    ServiceMigrationRestoredProof,
    ServiceMigrationStartedProof,
    ServiceMigrationStartOldReceipt,
    ServiceMigrationJournal,
    ServiceMigrationBackup,
    ServiceMigrationPort,
} from "./service-migration-types.js";

type Proof =
    | ServiceMigrationReloadedProof
    | ServiceMigrationStartedProof
    | ServiceMigrationRestoredProof;
interface Evidence {
    journal: ServiceMigrationJournal;
    expectedDigest: string;
    backupDigest: string;
    phase: string;
    kind: "reloaded" | "started" | "restored";
    payload?: ServiceMigrationReloadOldReceipt | ServiceMigrationStartOldReceipt;
    consumed: boolean;
}
const evidence = new WeakMap<object, Evidence>();

function issueServiceMigrationEffectProof(
    journal: ServiceMigrationJournal,
    expected: ServiceMigrationRecord,
    kind: Evidence["kind"],
    payload?: Evidence["payload"],
): Proof {
    const proof = Object.freeze(Object.create(null)) as Proof;
    evidence.set(proof, {
        journal,
        expectedDigest: digest(expected),
        backupDigest: expected.backupDigest,
        phase: expected.phase,
        kind,
        ...(payload ? { payload: structuredClone(payload) } : {}),
        consumed: false,
    });
    return proof;
}

/** 唯一效果签发入口；真实驱动完成动作/双观测后才把收据封装成一次性证明。 */
export class ServiceMigrationRollbackCoordinator {
    constructor(
        private readonly journal: ServiceMigrationJournal,
        private readonly port: Pick<
            ServiceMigrationPort,
            "reloadOriginal" | "startOriginal" | "verifyRestored"
        >,
        private readonly backup: ServiceMigrationBackup,
    ) {}
    async reload(expected: ServiceMigrationRecord): Promise<ServiceMigrationRecord> {
        const receipt = await this.port.reloadOriginal(this.backup, expected.backupDigest);
        return this.journal.transition(
            expected,
            issueServiceMigrationEffectProof(this.journal, expected, "reloaded", receipt),
        );
    }
    async start(expected: ServiceMigrationRecord): Promise<ServiceMigrationRecord> {
        if (!expected.reloadOldReceipt) throw new Error("旧服务重载证明缺失");
        const receipt = await this.port.startOriginal(this.backup, expected.reloadOldReceipt);
        return this.journal.transition(
            expected,
            issueServiceMigrationEffectProof(this.journal, expected, "started", receipt),
        );
    }
    async complete(expected: ServiceMigrationRecord): Promise<ServiceMigrationRecord> {
        if (
            !(await this.port.verifyRestored(
                this.backup,
                expected.reloadOldReceipt,
                expected.startOldReceipt,
            ))
        )
            throw new Error("旧服务恢复结果未知");
        return this.journal.transition(
            expected,
            issueServiceMigrationEffectProof(this.journal, expected, "restored"),
        );
    }
}

export function isServiceMigrationEffectProof(
    input: unknown,
): input is ServiceMigrationEffectProof {
    return Boolean(input && typeof input === "object" && evidence.has(input as object));
}

export function consumeServiceMigrationEffectProof(
    journal: ServiceMigrationJournal,
    expected: ServiceMigrationRecord,
    proof: Proof,
): Pick<Evidence, "kind" | "payload"> {
    const value = evidence.get(proof as object);
    if (
        !value ||
        value.consumed ||
        value.journal !== journal ||
        value.expectedDigest !== digest(expected) ||
        value.backupDigest !== expected.backupDigest ||
        value.phase !== expected.phase
    )
        throw new Error("服务迁移效果证明无效");
    value.consumed = true;
    return {
        kind: value.kind,
        ...(value.payload ? { payload: structuredClone(value.payload) } : {}),
    };
}

function digest(value: unknown): string {
    return createHash("sha256").update(canonical(value)).digest("hex");
}
function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`,
            )
            .join(",")}}`;
    return JSON.stringify(value);
}
