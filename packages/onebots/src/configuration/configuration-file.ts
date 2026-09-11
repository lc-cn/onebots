import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import yaml from "js-yaml";
import {
    parseConfigurationDocument,
    type ConfigurationDocument,
} from "./configuration-document.js";
import { ConfigurationConflictError } from "./configuration-store.js";

export interface ConfigurationFileSnapshot {
    revision: string;
    document: ConfigurationDocument;
}

export interface ConfigurationRawSnapshot {
    revision: string;
    bytes: Buffer;
}
export type ConfigurationFileInspection =
    | ({ state: "ready" } & ConfigurationFileSnapshot)
    | { state: "damaged"; revision: string; reason: "INVALID_YAML" };
const LIMIT = 1_048_576;

/** 管理域唯一配置文件写入器。replace/replaceRaw 必须持有工作区锁及生命周期串行入口。 */
export class ConfigurationFile {
    private readonly file: string;
    constructor(file: string) {
        this.file = path.resolve(file);
    }

    inspect(): ConfigurationFileInspection {
        const snapshot = this.readRaw();
        try {
            const text = new TextDecoder("utf-8", { fatal: true }).decode(snapshot.bytes);
            return {
                state: "ready",
                revision: snapshot.revision,
                document: parseConfigurationDocument(yaml.load(text)),
            };
        } catch {
            // 语法错误可能包含秘密，公开结果不带原文、原始字节或异常内容。
            return { state: "damaged", revision: snapshot.revision, reason: "INVALID_YAML" };
        }
    }

    read(): ConfigurationFileSnapshot {
        const value = this.inspect();
        if (value.state !== "ready")
            throw new Error("运行配置无法读取或解析，请通过私有恢复入口修复");
        return { revision: value.revision, document: value.document };
    }

    /** 仅管理域读取；不得把这个返回值作为 Web 快照。 */
    readRaw(): ConfigurationRawSnapshot {
        let descriptor: number | undefined;
        try {
            const initial = fs.lstatSync(this.file);
            if (
                !initial.isFile() ||
                initial.isSymbolicLink() ||
                initial.nlink !== 1 ||
                initial.size > LIMIT
            )
                throw new Error();
            descriptor = fs.openSync(
                this.file,
                fs.constants.O_RDONLY |
                    (fs.constants.O_NOFOLLOW ?? 0) |
                    (fs.constants.O_NONBLOCK ?? 0),
            );
            const before = fs.fstatSync(descriptor);
            if (
                !before.isFile() ||
                before.nlink !== 1 ||
                before.size > LIMIT ||
                before.dev !== initial.dev ||
                before.ino !== initial.ino
            )
                throw new Error();
            const content = Buffer.alloc(LIMIT + 1);
            let total = 0;
            while (total < content.length) {
                const count = fs.readSync(descriptor, content, total, content.length - total, null);
                if (!count) break;
                total += count;
            }
            const after = fs.fstatSync(descriptor);
            const current = fs.lstatSync(this.file);
            if (
                total > LIMIT ||
                total !== after.size ||
                after.nlink !== 1 ||
                before.size !== after.size ||
                before.mtimeMs !== after.mtimeMs ||
                before.ctimeMs !== after.ctimeMs ||
                current.isSymbolicLink() ||
                current.dev !== after.dev ||
                current.ino !== after.ino
            )
                throw new Error();
            const bytes = Buffer.from(content.subarray(0, total));
            return { revision: digest(bytes), bytes };
        } catch {
            throw new Error("运行配置文件不可用，请检查本地文件边界与权限");
        } finally {
            if (descriptor !== undefined) {
                try {
                    fs.closeSync(descriptor);
                } catch {
                    throw new Error("运行配置文件不可用，请检查本地文件边界与权限");
                }
            }
        }
    }

    serialize(document: unknown): Buffer {
        const clean = parseConfigurationDocument(document);
        const content = Buffer.from(yaml.dump(clean, { noRefs: true, lineWidth: -1 }));
        if (content.length > LIMIT) throw new Error("运行配置超过大小限制");
        return content;
    }

    replace(expectedRevision: string, document: unknown): ConfigurationFileSnapshot {
        const clean = parseConfigurationDocument(document);
        const content = this.serialize(clean);
        const result = this.replaceRaw(expectedRevision, content);
        return { revision: result.revision, document: clean };
    }

    /** 恢复原始坏 YAML 使用此入口；不解析或重写原始字节，不绕过 CAS。 */
    replaceRaw(expectedRevision: string, bytes: Uint8Array): ConfigurationRawSnapshot {
        if (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))
            throw new ConfigurationConflictError();
        if (!(bytes instanceof Uint8Array) || bytes.byteLength > LIMIT)
            throw new Error("运行配置原始字节无效");
        const content = Buffer.from(bytes);
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
            if (this.readRaw().revision !== expectedRevision)
                throw new ConfigurationConflictError();
            const descriptor = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(descriptor, content);
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            // 唯一管理写入器；同用户恶意进程的任意并发替换不属于隔离承诺。
            if (this.readRaw().revision !== expectedRevision)
                throw new ConfigurationConflictError();
            fs.renameSync(temporary, this.file);
            if (process.platform !== "win32") {
                const directory = fs.openSync(path.dirname(this.file), "r");
                try {
                    fs.fsyncSync(directory);
                } finally {
                    fs.closeSync(directory);
                }
            }
            return { revision: digest(content), bytes: Buffer.from(content) };
        } catch (error) {
            if (error instanceof ConfigurationConflictError) throw error;
            throw new Error("运行配置写入未确认，请检查配置操作状态");
        } finally {
            try {
                fs.rmSync(temporary, { force: true });
            } catch {
                throw new Error("运行配置临时文件清理未确认");
            }
        }
    }
}

function digest(value: Uint8Array): string {
    return createHash("sha256").update(value).digest("hex");
}
