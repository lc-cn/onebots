import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { ValidationError } from "@onebots/core";

export const PUBLIC_STATIC_REVISION_HEADER = "X-OneBots-Public-Static-Revision";
export const EXPECTED_PUBLIC_STATIC_REVISION_HEADER = "X-OneBots-Expected-Public-Static-Revision";

interface PublicStaticRevisionContext {
    get?(name: string): string;
    set(name: string, value: string): void;
}

export interface PublicStaticSnapshot {
    files: string[];
    revision: string;
}

/** 绑定静态根身份及其全部目录项，避免同名文件被替换后旧页面继续写入。 */
export function capturePublicStaticSnapshot(root: string): PublicStaticSnapshot {
    const resolvedRoot = path.resolve(root);
    const rootStats = fs.lstatSync(resolvedRoot, { bigint: true });
    if (!rootStats.isDirectory()) throw new Error("站点静态根不是目录");
    const entries = fs
        .readdirSync(resolvedRoot, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    const files: string[] = [];
    const evidence = entries.map(entry => {
        const stats = fs.lstatSync(path.join(resolvedRoot, entry.name), { bigint: true });
        if (stats.isFile()) files.push(entry.name);
        return [
            entry.name,
            staticEntryKind(stats),
            stats.dev.toString(),
            stats.ino.toString(),
            stats.size.toString(),
            stats.mtimeNs.toString(),
            stats.ctimeNs.toString(),
            stats.mode.toString(),
        ];
    });
    const payload = JSON.stringify({
        root: [
            resolvedRoot,
            rootStats.dev.toString(),
            rootStats.ino.toString(),
            rootStats.mode.toString(),
        ],
        entries: evidence,
    });
    return {
        files,
        revision: `sha256:${createHash("sha256").update(payload).digest("hex")}`,
    };
}

export function setPublicStaticRevision(
    context: Pick<PublicStaticRevisionContext, "set">,
    revision: string,
): void {
    context.set(PUBLIC_STATIC_REVISION_HEADER, revision);
}

/** 兼容旧客户端省略前置条件；新客户端可拒绝目录内容或根路径已经变化的写操作。 */
export function assertPublicStaticRevisionPrecondition(
    context: Pick<PublicStaticRevisionContext, "get">,
    root: string,
    operation: string,
): void {
    const rawExpected = context.get?.(EXPECTED_PUBLIC_STATIC_REVISION_HEADER) ?? "";
    if (!rawExpected) return;
    const expected = rawExpected.trim();
    if (!/^sha256:[a-f0-9]{64}$/u.test(expected)) {
        throw new ValidationError(`${operation}请求的静态目录修订号无效`);
    }
    if (capturePublicStaticSnapshot(root).revision !== expected) {
        throw new PublicStaticRevisionMismatchError(
            `${operation}使用的静态文件列表已经过期，请刷新后再操作`,
        );
    }
}

export class PublicStaticRevisionMismatchError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "PublicStaticRevisionMismatchError";
    }
}

function staticEntryKind(stats: fs.BigIntStats): string {
    if (stats.isFile()) return "file";
    if (stats.isDirectory()) return "directory";
    if (stats.isSymbolicLink()) return "symlink";
    return "other";
}
