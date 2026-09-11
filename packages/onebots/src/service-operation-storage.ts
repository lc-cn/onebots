import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
const invalid = () => new Error("服务操作私有存储不可用");
const NAME = /^[A-Za-z0-9_-]{1,128}\.json$/;

/** 同服务级锁内使用；固定私有目录、文件名边界与有界JSON，不提供任意路径访问。 */
export class ServiceOperationStorage {
    private readonly directory: string;
    private readonly identity: { dev: number; ino: number };
    constructor(directory: string) {
        try {
            fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
            this.directory = fs.realpathSync(directory);
            const stat = fs.lstatSync(directory);
            if (
                !stat.isDirectory() ||
                stat.isSymbolicLink() ||
                (process.getuid && stat.uid !== process.getuid()) ||
                (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
            )
                throw invalid();
            this.identity = { dev: stat.dev, ino: stat.ino };
            sync(path.dirname(this.directory));
        } catch {
            throw invalid();
        }
    }
    list(): string[] {
        try {
            this.check();
            const names = fs.readdirSync(this.directory);
            if (names.length > 10000 || names.some(name => !NAME.test(name))) throw invalid();
            return names;
        } catch {
            throw invalid();
        }
    }
    has(name: string): boolean {
        try {
            fs.lstatSync(this.file(name));
            return true;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
            throw invalid();
        }
    }
    read(name: string): unknown {
        try {
            const file = this.file(name);
            const stat = fs.lstatSync(file);
            if (
                !stat.isFile() ||
                stat.isSymbolicLink() ||
                stat.nlink !== 1 ||
                stat.size > 32_768 ||
                (process.getuid && stat.uid !== process.getuid()) ||
                (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o600)
            )
                throw invalid();
            const fd = fs.openSync(
                file,
                fs.constants.O_RDONLY |
                    (fs.constants.O_NOFOLLOW ?? 0) |
                    (fs.constants.O_NONBLOCK ?? 0),
            );
            try {
                const before = fs.fstatSync(fd);
                if (
                    before.dev !== stat.dev ||
                    before.ino !== stat.ino ||
                    before.mode !== stat.mode ||
                    before.size !== stat.size
                )
                    throw invalid();
                const buffer = Buffer.alloc(32_769);
                const count = fs.readSync(fd, buffer, 0, buffer.length, 0);
                const after = fs.fstatSync(fd);
                const current = fs.lstatSync(file);
                if (
                    count > 32_768 ||
                    count !== stat.size ||
                    after.ctimeMs !== stat.ctimeMs ||
                    after.mtimeMs !== stat.mtimeMs ||
                    current.dev !== stat.dev ||
                    current.ino !== stat.ino ||
                    current.nlink !== 1 ||
                    current.mode !== stat.mode
                )
                    throw invalid();
                return JSON.parse(
                    new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)),
                );
            } finally {
                fs.closeSync(fd);
            }
        } catch {
            throw invalid();
        }
    }
    write(name: string, value: unknown, createOnly = false): void {
        let temporary: string | undefined;
        try {
            const file = this.file(name);
            const content = canonicalServiceJson(value);
            if (Buffer.byteLength(content) > 32_768) throw invalid();
            if (createOnly ? this.has(name) : !this.has(name)) throw invalid();
            if (!createOnly) this.read(name);
            temporary = path.join(this.directory, `.operation-${randomUUID()}.tmp`);
            const fd = fs.openSync(temporary, "wx", 0o600);
            try {
                fs.writeFileSync(fd, content);
                fs.fsyncSync(fd);
            } finally {
                fs.closeSync(fd);
            }
            this.check();
            if (createOnly) {
                fs.linkSync(temporary, file);
                fs.unlinkSync(temporary);
            } else {
                this.read(name);
                fs.renameSync(temporary, file);
            }
            sync(this.directory);
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
    private file(name: string): string {
        this.check();
        if (typeof name !== "string" || !NAME.test(name)) throw invalid();
        return path.join(this.directory, name);
    }
    private check(): void {
        const stat = fs.lstatSync(this.directory);
        if (
            !stat.isDirectory() ||
            stat.isSymbolicLink() ||
            stat.dev !== this.identity.dev ||
            stat.ino !== this.identity.ino ||
            (process.platform !== "win32" && (stat.mode & 0o7777) !== 0o700)
        )
            throw invalid();
    }
}
/** 输入已由领域parser闭合校验；这里只稳定对象键排序，不接受未验证请求。 */
export function canonicalServiceJson(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonicalServiceJson).join(",")}]`;
    if (value && typeof value === "object")
        return `{${Object.keys(value)
            .sort()
            .map(
                key =>
                    `${JSON.stringify(key)}:${canonicalServiceJson((value as Record<string, unknown>)[key])}`,
            )
            .join(",")}}`;
    return JSON.stringify(value);
}
export function closedServiceObject(
    value: unknown,
    keys: readonly string[],
): Record<string, unknown> {
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        ![Object.prototype, null].includes(Object.getPrototypeOf(value))
    )
        throw invalid();
    const own = Reflect.ownKeys(value);
    if (
        own.length !== keys.length ||
        own.some(key => typeof key !== "string" || !keys.includes(key))
    )
        throw invalid();
    const result: Record<string, unknown> = {};
    for (const key of keys) {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        result[key] = descriptor.value;
    }
    return result;
}
function sync(directory: string): void {
    if (process.platform === "win32") return;
    const fd = fs.openSync(directory, "r");
    try {
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}
