import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { parseConfigurationDocument, type ConfigurationValue } from "./configuration-document.js";

export interface ConfigurationBase {
    generationId: string | null;
    configRevision: string;
}

export interface ConfigurationRepairReference {
    backupId: string;
    originalRevision: string;
}

export interface ConfigurationDraft {
    mode?: "repair";
    repair?: ConfigurationRepairReference;
    schemaVersion: 1;
    id: string;
    revision: string;
    base: ConfigurationBase;
    document: Record<string, unknown>;
}

export class ConfigurationConflictError extends Error {
    constructor() {
        super("配置已发生变化，请重新读取后操作");
    }
}

/** 私有草稿库；唯一管理服务持有工作区锁。返回值含凭据，只能在管理域内部使用。 */
export class ConfigurationStore {
    private readonly directory: string;

    constructor(directory: string) {
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
        if (fs.lstatSync(directory).isSymbolicLink()) throw new Error("配置草稿目录无效");
        this.directory = fs.realpathSync(directory);
        fs.chmodSync(this.directory, 0o700);
    }

    create(base: ConfigurationBase, document: Record<string, unknown>): ConfigurationDraft {
        validateBase(base);
        const draft = this.make(randomUUID(), base, document);
        this.write(draft);
        return structuredClone(draft);
    }

    createRepair(
        base: ConfigurationBase,
        document: Record<string, unknown>,
        repair: ConfigurationRepairReference,
    ): ConfigurationDraft {
        const draft = this.make(
            randomUUID(),
            base,
            document,
            parseConfigurationRepairReference(repair, base),
        );
        this.write(draft);
        return structuredClone(draft);
    }

    read(id: string): ConfigurationDraft {
        try {
            const file = this.file(id);
            const info = fs.lstatSync(file);
            if (
                !info.isFile() ||
                info.isSymbolicLink() ||
                info.nlink !== 1 ||
                info.size > 1_048_576
            )
                throw new Error("invalid");
            const raw: unknown = JSON.parse(fs.readFileSync(file, "utf8"));
            if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("invalid");
            const value = raw as Record<string, unknown>;
            if (value.schemaVersion !== 1 || value.id !== id || typeof value.revision !== "string")
                throw new Error("invalid");
            const repairing = value.mode === "repair";
            const keys = repairing
                ? "base,document,id,mode,repair,revision,schemaVersion"
                : "base,document,id,revision,schemaVersion";
            if (Object.keys(value).sort().join(",") !== keys) throw new Error("invalid");
            const draft = this.make(
                id,
                value.base as ConfigurationBase,
                value.document as Record<string, unknown>,
                repairing
                    ? parseConfigurationRepairReference(
                          value.repair,
                          value.base as ConfigurationBase,
                      )
                    : undefined,
            );
            if (draft.revision !== value.revision) throw new Error("invalid");
            return draft;
        } catch {
            // 不把 JSON 片段、路径或配置值带入可见诊断。
            throw new Error("配置草稿不存在或已损坏");
        }
    }

    replace(
        id: string,
        expectedRevision: string,
        document: Record<string, unknown>,
    ): ConfigurationDraft {
        const previous = this.read(id);
        if (previous.revision !== expectedRevision) throw new ConfigurationConflictError();
        const draft = this.make(id, previous.base, document, previous.repair);
        this.write(draft);
        return structuredClone(draft);
    }

    private make(
        id: string,
        base: ConfigurationBase,
        document: Record<string, unknown>,
        repair?: ConfigurationRepairReference,
    ): ConfigurationDraft {
        validateBase(base);
        const serialized = canonicalConfiguration(document);
        const snapshot = JSON.parse(serialized) as Record<string, unknown>;
        const ownedBase = { generationId: base.generationId, configRevision: base.configRevision };
        const mode = repair
            ? { mode: "repair" as const, repair: parseConfigurationRepairReference(repair, base) }
            : undefined;
        const revision = createHash("sha256")
            .update(
                JSON.stringify(
                    mode ? [id, ownedBase, serialized, mode] : [id, ownedBase, serialized],
                ),
            )
            .digest("hex");
        return { schemaVersion: 1, id, revision, base: ownedBase, document: snapshot, ...mode };
    }

    private file(id: string): string {
        if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id))
            throw new Error("配置草稿标识无效");
        return path.join(this.directory, `${id}.json`);
    }

    private write(draft: ConfigurationDraft): void {
        const target = this.file(draft.id);
        const temporary = `${target}.${randomUUID()}.tmp`;
        const content = JSON.stringify(draft);
        if (Buffer.byteLength(content) > 1_048_576) throw new Error("配置草稿超过大小限制");
        try {
            const descriptor = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(descriptor, content);
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            fs.renameSync(temporary, target);
            const directory = fs.openSync(this.directory, "r");
            try {
                fs.fsyncSync(directory);
            } finally {
                fs.closeSync(directory);
            }
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }
}

/** 与编辑及校验共用 JSON 边界，仅排序对象键以稳定摘要。 */
export function canonicalConfiguration(document: Record<string, unknown>): string {
    const normalize = (value: ConfigurationValue): ConfigurationValue => {
        if (Array.isArray(value)) return value.map(normalize);
        if (value === null || typeof value !== "object") return value;
        const result: Record<string, ConfigurationValue> = {};
        for (const key of Object.keys(value).sort()) result[key] = normalize(value[key]);
        return result;
    };
    const result = JSON.stringify(normalize(parseConfigurationDocument(document)));
    if (Buffer.byteLength(result) > 1_000_000) throw new Error("配置超过大小限制");
    return result;
}

function validateBase(base: ConfigurationBase): void {
    if (
        !base ||
        typeof base !== "object" ||
        Array.isArray(base) ||
        Object.keys(base).length !== 2 ||
        !(
            base.generationId === null ||
            (typeof base.generationId === "string" &&
                /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
                    base.generationId,
                ))
        ) ||
        typeof base.configRevision !== "string" ||
        !/^[a-f0-9]{64}$/.test(base.configRevision)
    )
        throw new Error("配置基础版本无效");
}

/** 修复授权引用只允许不透明标识与原始字节摘要，不接受文件路径。 */
export function parseConfigurationRepairReference(
    value: unknown,
    base: ConfigurationBase,
): ConfigurationRepairReference {
    validateBase(base);
    const parsed = parseConfigurationDocument(value);
    if (
        Object.keys(parsed).sort().join(",") !== "backupId,originalRevision" ||
        typeof parsed.backupId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(parsed.backupId) ||
        parsed.originalRevision !== base.configRevision
    )
        throw new Error("配置修复引用无效");
    return { backupId: parsed.backupId, originalRevision: base.configRevision };
}
