import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
    createGenerationPlan,
    type GenerationPlan,
    type GenerationSelection,
} from "../installation/generation-plan.js";
import type { UpdateConfirmation } from "./installation-update.js";
import { hasExtensionRemoval, type ExtensionRemovalConfirmation } from "./extension-removal.js";

export interface StoredInstallationPlan {
    schemaVersion: 1;
    baseGenerationId: string | null;
    plan: GenerationPlan;
    update?: UpdateConfirmation;
    removal?: ExtensionRemovalConfirmation;
}

/** 安装确认的私有持久化边界；计划 ID 覆盖基线、工件与移除配置快照。 */
export class ControlInstallationPlanStore {
    private readonly directory: string;

    constructor(controlDirectory: string) {
        this.directory = path.join(controlDirectory, "plans");
        fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(this.directory).isSymbolicLink())
            throw new Error("安装计划目录不能是符号链接");
        fs.chmodSync(this.directory, 0o700);
    }

    confirm(
        plan: GenerationPlan,
        expectedGenerationId: string | null,
        recommendations: string[],
        update?: UpdateConfirmation,
        removal?: ExtensionRemovalConfirmation,
    ) {
        const confirmation: StoredInstallationPlan = {
            schemaVersion: 1,
            baseGenerationId: expectedGenerationId,
            plan,
            ...(update ? { update } : {}),
            ...(removal ? { removal } : {}),
        };
        const id = digest(confirmation);
        const file = this.file(id);
        if (!fs.existsSync(file)) atomicWrite(file, confirmation);
        else this.read(id);
        return {
            id,
            planDigest: plan.digest,
            baseGenerationId: expectedGenerationId,
            selection: plan.selection,
            removed: removal?.selection ?? { adapters: [], protocols: [], applications: [] },
            packages: [
                plan.host,
                plan.core,
                ...plan.extensions.map(extension => ({
                    name: extension.packageName,
                    version: extension.version,
                })),
            ].map(artifact => ({ name: artifact.name, version: artifact.version })),
            peers: plan.peerRequirements,
            recommendations,
        };
    }

    read(id: string): StoredInstallationPlan {
        const file = this.file(id);
        try {
            const input = readPrivate(file) as StoredInstallationPlan;
            const plan = createGenerationPlan({ ...input.plan, target: input.plan });
            const keys = [
                "baseGenerationId",
                "plan",
                "schemaVersion",
                ...(input.update === undefined ? [] : ["update"]),
                ...(input.removal === undefined ? [] : ["removal"]),
            ].sort();
            if (
                input.schemaVersion !== 1 ||
                Object.keys(input).sort().join(",") !== keys.join(",") ||
                !validUpdate(input.update) ||
                !validRemoval(input.removal, input.plan.selection) ||
                (input.update !== undefined && input.removal !== undefined) ||
                !(input.baseGenerationId === null || typeof input.baseGenerationId === "string") ||
                digest(input) !== id ||
                JSON.stringify(plan) !== JSON.stringify(input.plan)
            )
                throw new Error("安装计划已变化");
            return input;
        } catch {
            throw new Error("安装计划不可读取或已变化，请重新确认");
        }
    }

    private file(id: string): string {
        if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id))
            throw new Error("安装计划标识无效");
        return path.join(this.directory, `${id}.json`);
    }
}

function validUpdate(value: UpdateConfirmation | undefined): boolean {
    return (
        value === undefined ||
        (Object.keys(value).sort().join(",") === "archiveSha256,configRevision" &&
            /^[a-f0-9]{64}$/.test(value.configRevision) &&
            /^[a-f0-9]{64}$/.test(value.archiveSha256))
    );
}

function validRemoval(
    value: ExtensionRemovalConfirmation | undefined,
    target: GenerationSelection,
): boolean {
    if (value === undefined) return true;
    try {
        const removal = normalizeSelection(value.selection);
        return (
            Object.keys(value).sort().join(",") === "configRevision,selection" &&
            Object.keys(value.selection).sort().join(",") === "adapters,applications,protocols" &&
            /^[a-f0-9]{64}$/.test(value.configRevision) &&
            hasExtensionRemoval(removal) &&
            (["adapters", "protocols", "applications"] as const).every(type =>
                removal[type].every(name => !target[type].includes(name)),
            )
        );
    } catch {
        return false;
    }
}

function normalizeSelection(selection: GenerationSelection): GenerationSelection {
    const normalized = {} as GenerationSelection;
    for (const type of ["adapters", "protocols", "applications"] as const) {
        const values = selection[type];
        if (
            !Array.isArray(values) ||
            values.length > 100 ||
            values.some(value => typeof value !== "string" || !value || value.length > 128) ||
            new Set(values).size !== values.length
        )
            throw new Error("扩展选择无效");
        normalized[type] = [...values];
    }
    return normalized;
}

function digest(value: unknown): string {
    return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function readPrivate(file: string): unknown {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024)
        throw new Error("安装记录无效");
    return JSON.parse(fs.readFileSync(file, "utf8"));
}

function atomicWrite(file: string, value: unknown): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, JSON.stringify(value) + "\n");
            fs.fsyncSync(descriptor);
        } finally {
            fs.closeSync(descriptor);
        }
        fs.renameSync(temporary, file);
        if (process.platform !== "win32") {
            const parent = fs.openSync(path.dirname(file), "r");
            try {
                fs.fsyncSync(parent);
            } finally {
                fs.closeSync(parent);
            }
        }
    } finally {
        fs.rmSync(temporary, { force: true });
    }
}
