import { parseConfigurationDocument } from "./configuration-document.js";
const HASH = /^[a-f0-9]{64}$/;
import fs from "node:fs";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import type {
    ConfigurationApplicationJournal,
    ConfigurationApplicationOptions,
} from "./configuration-application.js";
const invalid = () => new Error("配置应用私有存储无效");
/** 日志摘要不是覆盖许可；必须重新绑定已验证的候选正文。 */
export function checkRepairRevisions(
    operation: ConfigurationApplicationJournal,
    document: Record<string, unknown>,
    source: ConfigurationApplicationOptions["source"],
): void {
    if (!source.serialize) throw invalid();
    const candidate = createHash("sha256").update(source.serialize(document)).digest("hex");
    if (
        operation.candidateRevision !== candidate ||
        operation.previousDigest !== operation.base.configRevision ||
        (operation.configRevision !== undefined &&
            operation.configRevision !== candidate &&
            operation.configRevision !== operation.base.configRevision)
    )
        throw invalid();
}
export function privateDirectory(directory: string): void {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (!fs.lstatSync(directory).isDirectory() || fs.lstatSync(directory).isSymbolicLink())
        throw invalid();
    fs.chmodSync(directory, 0o700);
}
export function readFile(file: string, max: number): string {
    const stat = fs.lstatSync(file);
    if (
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1 ||
        stat.size > max ||
        (process.platform !== "win32" && (stat.mode & 0o077) !== 0)
    )
        throw invalid();
    return fs.readFileSync(file, "utf8");
}
export function atomic(file: string, content: string): void {
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
        const descriptor = fs.openSync(temporary, "wx", 0o600);
        try {
            fs.writeFileSync(descriptor, content);
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

export function checkRepair(value: unknown, base: unknown): void {
    const reference = parseConfigurationDocument(value);
    const expected = parseConfigurationDocument(base);
    if (
        Object.keys(reference).sort().join(",") !== "backupId,originalRevision" ||
        typeof reference.backupId !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
            reference.backupId,
        ) ||
        typeof reference.originalRevision !== "string" ||
        !HASH.test(reference.originalRevision) ||
        reference.originalRevision !== expected.configRevision
    )
        throw invalid();
}
