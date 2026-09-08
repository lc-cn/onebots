import fs from "node:fs";
import path from "node:path";

export type DiagnosticStorageState = "ready" | "creatable" | "invalid" | "unavailable";
export interface DiagnosticStorageInspection {
    dataDirectory: DiagnosticStorageState;
    database: DiagnosticStorageState;
    publicStatic: "ready" | "disabled" | "invalid" | "unavailable";
    databaseIntegrity: "not-checked";
}
function safeInput(value: string): boolean {
    return value.length > 0 && !/[\u0000-\u001f\u007f]/.test(value);
}
function stat(file: string): fs.Stats | null {
    try {
        return fs.lstatSync(file);
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}
/** 只允许自身或系统所有的祖先；共享 sticky 根只能是祖先，不能是目标直接父目录。 */
function safeParents(directory: string): { existing: string; missing: boolean } | null {
    let current = path.parse(directory).root;
    let missing = false;
    let existing = current;
    for (const part of directory.split(path.sep).filter(Boolean)) {
        current = path.join(current, part);
        const entry = stat(current);
        if (!entry) {
            missing = true;
            continue;
        }
        const stickyAncestor =
            current !== directory && entry.uid === 0 && Boolean(entry.mode & 0o1000);
        if (
            missing ||
            !entry.isDirectory() ||
            entry.isSymbolicLink() ||
            (entry.uid !== process.getuid?.() && entry.uid !== 0) ||
            ((entry.mode & 0o022) !== 0 && !stickyAncestor) ||
            fs.realpathSync(current) !== current
        )
            return null;
        fs.accessSync(current, fs.constants.X_OK);
        existing = current;
    }
    return { existing, missing };
}
function inspect(file: string, directory: boolean, sensitive: boolean): DiagnosticStorageState {
    try {
        const parents = safeParents(path.dirname(file));
        if (!parents) return "invalid";
        const entry = stat(file);
        if (!entry) {
            fs.accessSync(
                parents.existing,
                fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
            );
            return "creatable";
        }
        if (
            parents.missing ||
            entry.isSymbolicLink() ||
            (directory ? !entry.isDirectory() : !entry.isFile() || entry.nlink !== 1) ||
            entry.uid !== process.getuid?.() ||
            (entry.mode & 0o022) !== 0 ||
            (sensitive && (entry.mode & 0o077) !== 0) ||
            fs.realpathSync(file) !== file
        )
            return "invalid";
        fs.accessSync(
            file,
            fs.constants.R_OK |
                (sensitive ? fs.constants.W_OK : 0) |
                (directory ? fs.constants.X_OK : 0),
        );
        if (!directory)
            fs.accessSync(
                path.dirname(file),
                fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK,
            );
        return "ready";
    } catch {
        return "unavailable";
    }
}
function ownValue(document: Record<string, unknown>, key: string): unknown {
    const descriptor = Object.getOwnPropertyDescriptor(document, key);
    if (!descriptor) return undefined;
    if (!("value" in descriptor)) throw new Error();
    return descriptor.value;
}
function descendant(root: string, candidate: string): boolean {
    const relative = path.relative(root, candidate);
    return (
        Boolean(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}
/** 只观察文件类型、权限和可创建性；不读取配置/数据库内容、不触发 SQLite 或插件初始化。 */
export function inspectDiagnosticStorage(
    workspace: string,
    document: Record<string, unknown> | null,
): DiagnosticStorageInspection {
    const result: DiagnosticStorageInspection = {
        dataDirectory: "unavailable",
        database: "unavailable",
        publicStatic: "unavailable",
        databaseIntegrity: "not-checked",
    };
    if (
        !document ||
        typeof document !== "object" ||
        Array.isArray(document) ||
        !safeInput(workspace) ||
        !path.isAbsolute(workspace)
    )
        return result;
    const root = path.resolve(workspace);
    try {
        const parent = safeParents(root);
        if (!parent || parent.missing) return result;
    } catch {
        return result;
    }
    const data = path.join(root, "data");
    result.dataDirectory = inspect(data, true, true);
    try {
        const value = ownValue(document, "database");
        const configured = value === undefined ? "onebots.db" : value;
        if (typeof configured !== "string" || !safeInput(configured)) result.database = "invalid";
        else {
            // 与 core resolveDatabaseFilePath 相同：绝对路径保留；缺 .db 后缀时补齐。
            const resolved = path.resolve(data, configured);
            result.database = inspect(
                resolved.endsWith(".db") ? resolved : `${resolved}.db`,
                false,
                true,
            );
            if (result.dataDirectory === "invalid" && descendant(data, resolved))
                result.database = "invalid";
        }
    } catch {
        result.database = "invalid";
    }
    try {
        const configured = ownValue(document, "public_static_dir");
        if (configured === undefined) result.publicStatic = "disabled";
        else if (typeof configured !== "string") result.publicStatic = "invalid";
        else if (!configured.trim()) result.publicStatic = "disabled";
        else if (!safeInput(configured)) result.publicStatic = "invalid";
        else {
            const value = configured.trim(),
                resolved = path.resolve(root, value);
            if (!path.isAbsolute(value) && !descendant(root, resolved))
                result.publicStatic = "invalid";
            else {
                const status = inspect(resolved, true, false);
                result.publicStatic = status === "creatable" ? "unavailable" : status;
            }
        }
    } catch {
        result.publicStatic = "invalid";
    }
    return result;
}
