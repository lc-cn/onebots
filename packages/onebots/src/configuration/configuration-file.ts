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

/** 管理域唯一配置文件写入器。调用 replace 必须已持有工作区锁及生命周期串行入口。 */
export class ConfigurationFile {
    private readonly file: string;
    constructor(file: string) {
        this.file = path.resolve(file);
    }

    read(): ConfigurationFileSnapshot {
        try {
            const bytes = this.bytes();
            const document = parseConfigurationDocument(yaml.load(bytes.toString("utf8")));
            return { revision: digest(bytes), document };
        } catch {
            // 损坏 YAML 可能在解析错误首行包含凭据，完全不转发原始错误。
            throw new Error("运行配置无法读取或解析，请通过私有恢复入口修复");
        }
    }

    replace(expectedRevision: string, document: unknown): ConfigurationFileSnapshot {
        const clean = parseConfigurationDocument(document);
        if (typeof expectedRevision !== "string" || !/^[a-f0-9]{64}$/.test(expectedRevision))
            throw new ConfigurationConflictError();
        const content = Buffer.from(yaml.dump(clean, { noRefs: true, lineWidth: -1 }));
        if (content.length > 1_048_576) throw new Error("运行配置超过大小限制");
        const temporary = `${this.file}.${randomUUID()}.tmp`;
        try {
            if (digest(this.bytes()) !== expectedRevision) throw new ConfigurationConflictError();
            const descriptor = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(descriptor, content);
                fs.fsyncSync(descriptor);
            } finally {
                fs.closeSync(descriptor);
            }
            // 检查编辑期间已观察到的外部更改；运行中禁止其他写入器绕过管理服务。
            if (digest(this.bytes()) !== expectedRevision) throw new ConfigurationConflictError();
            fs.renameSync(temporary, this.file);
            const directory = fs.openSync(path.dirname(this.file), "r");
            try {
                fs.fsyncSync(directory);
            } finally {
                fs.closeSync(directory);
            }
            return { revision: digest(content), document: clean };
        } catch (error) {
            if (error instanceof ConfigurationConflictError) throw error;
            throw new Error("运行配置写入未确认，请检查配置操作状态");
        } finally {
            fs.rmSync(temporary, { force: true });
        }
    }

    private bytes(): Buffer {
        const stat = fs.lstatSync(this.file);
        if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1_048_576)
            throw new Error("配置文件无效");
        return fs.readFileSync(this.file);
    }
}

function digest(value: Buffer): string {
    return createHash("sha256").update(value).digest("hex");
}
