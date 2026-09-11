import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { ConfigurationFile } from "./configuration-file.js";

export interface ConfigurationRecoveryReference {
    backupId: string;
    originalRevision: string;
}
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const invalid = () => new Error("配置原始备份不可用，请检查私有恢复记录");

/** 原始秘密字节只留在管理域；备份不提供公网读取或自动删除接口。 */
export class ConfigurationRecoveryStore {
    private readonly directory: string;
    private readonly identity: { dev: number; ino: number };
    constructor(directory: string) {
        try {
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            const stat = fs.lstatSync(directory);
            if (!stat.isDirectory() || stat.isSymbolicLink()) throw invalid();
            this.directory = fs.realpathSync(directory);
            fs.chmodSync(this.directory, 0o700);
            this.identity = { dev: stat.dev, ino: stat.ino };
            if (process.platform !== "win32") {
                const parent = fs.openSync(path.dirname(this.directory), "r");
                try {
                    fs.fsyncSync(parent);
                } finally {
                    fs.closeSync(parent);
                }
            }
        } catch {
            throw invalid();
        }
    }

    backup(snapshot: { revision: string; bytes: Uint8Array }): ConfigurationRecoveryReference {
        let temporary: string | undefined;
        try {
            this.checkDirectory();
            if (
                !snapshot ||
                typeof snapshot.revision !== "string" ||
                !HASH.test(snapshot.revision) ||
                !(snapshot.bytes instanceof Uint8Array) ||
                snapshot.bytes.byteLength > 1_048_576
            )
                throw invalid();
            const bytes = Buffer.from(snapshot.bytes);
            if (hash(bytes) !== snapshot.revision) throw invalid();
            const ref = { backupId: randomUUID(), originalRevision: snapshot.revision };
            const file = this.file(ref);
            temporary = `${file}.${randomUUID()}.tmp`;
            const fd = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(fd, bytes);
                fs.fchmodSync(fd, 0o400);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            // 校验已写入的真实工件，而不是把源摘要当作复制成功证明。
            if (new ConfigurationFile(temporary).readRaw().revision !== ref.originalRevision)
                throw invalid();
            this.checkDirectory();
            if (fs.existsSync(file)) throw invalid();
            fs.renameSync(temporary, file);
            if (process.platform !== "win32") {
                const directory = fs.openSync(this.directory, "r");
                try {
                    fs.fsyncSync(directory);
                } finally {
                    fs.closeSync(directory);
                }
            }
            this.read(ref);
            return ref;
        } catch {
            throw invalid();
        } finally {
            if (temporary) {
                try {
                    fs.rmSync(temporary, { force: true });
                } catch {
                    throw invalid();
                }
            }
        }
    }

    read(ref: ConfigurationRecoveryReference): Buffer {
        try {
            this.checkDirectory();
            const file = this.file(ref);
            const stat = fs.lstatSync(file);
            if (process.platform !== "win32" && (stat.mode & 0o777) !== 0o400) throw invalid();
            const snapshot = new ConfigurationFile(file).readRaw();
            if (snapshot.revision !== ref.originalRevision) throw invalid();
            return snapshot.bytes;
        } catch {
            throw invalid();
        }
    }
    private file(ref: ConfigurationRecoveryReference): string {
        if (
            !ref ||
            typeof ref.backupId !== "string" ||
            !UUID.test(ref.backupId) ||
            typeof ref.originalRevision !== "string" ||
            !HASH.test(ref.originalRevision)
        )
            throw invalid();
        return path.join(this.directory, `${ref.backupId}.yaml`);
    }
    private checkDirectory(): void {
        const stat = fs.lstatSync(this.directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            stat.dev !== this.identity.dev ||
            stat.ino !== this.identity.ino ||
            (process.platform !== "win32" && (stat.mode & 0o777) !== 0o700)
        )
            throw invalid();
    }
}
function hash(bytes: Uint8Array): string {
    return createHash("sha256").update(bytes).digest("hex");
}
