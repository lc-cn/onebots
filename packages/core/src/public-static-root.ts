import * as fs from "node:fs";
import * as path from "node:path";
import type { Logger } from "./logger.js";

export type PublicStaticRootInspection =
    | { status: "disabled"; root: null; created: false }
    | { status: "missing"; root: string; created: false }
    | { status: "ready"; root: string; created: boolean }
    | { status: "invalid"; root: string; created: false; error: string };

/** 以运行时相同的真实路径规则检查静态目录，并且仅在明确要求时创建缺失目录。 */
export function inspectPublicStaticRoot(
    configDir: string,
    configured: string | undefined,
    create = false,
): PublicStaticRootInspection {
    const value = configured?.trim();
    if (!value) return { status: "disabled", root: null, created: false };

    const configRoot = path.resolve(configDir);
    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(configRoot, value);
    if (!path.isAbsolute(value) && !isStrictDescendant(configRoot, absolute)) {
        return {
            status: "invalid",
            root: absolute,
            created: false,
            error: "public_static_dir 必须为配置目录下的子目录，已忽略",
        };
    }

    try {
        const resolvedConfigRoot = path.isAbsolute(value) ? null : fs.realpathSync(configRoot);
        if (resolvedConfigRoot) {
            const existingAncestor = fs.realpathSync(findExistingAncestor(absolute));
            if (!isWithinOrEqual(resolvedConfigRoot, existingAncestor)) {
                return escapedPublicStaticRoot(absolute);
            }
        }

        let created = false;
        if (!fs.existsSync(absolute)) {
            if (!create) return { status: "missing", root: absolute, created: false };
            fs.mkdirSync(absolute, { recursive: true });
            created = true;
        }

        const resolved = fs.realpathSync(absolute);
        if (resolvedConfigRoot && !isStrictDescendant(resolvedConfigRoot, resolved)) {
            return escapedPublicStaticRoot(resolved);
        }
        if (!fs.statSync(resolved).isDirectory()) {
            return {
                status: "invalid",
                root: resolved,
                created: false,
                error: "public_static_dir 不是目录，已忽略",
            };
        }
        fs.accessSync(resolved, fs.constants.R_OK);
        return { status: "ready", root: resolved, created };
    } catch (error) {
        return {
            status: "invalid",
            root: absolute,
            created: false,
            error: `public_static_dir 无法创建或访问，静态托管已跳过: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/** 解析并准备受约束的站点根静态目录。 */
export function resolvePublicStaticRoot(
    configDir: string,
    configured: string | undefined,
    logger: Logger,
): string | null {
    const inspection = inspectPublicStaticRoot(configDir, configured, true);
    if (inspection.status === "disabled") return null;
    if (inspection.status === "ready") return inspection.root;
    logger.warn(
        inspection.status === "missing"
            ? "public_static_dir 尚未创建，静态托管已跳过"
            : inspection.error,
        { configured, resolved: inspection.root, configDir: path.resolve(configDir) },
    );
    return null;
}

function findExistingAncestor(target: string): string {
    let candidate = target;
    while (true) {
        try {
            fs.lstatSync(candidate);
            return candidate;
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
        const parent = path.dirname(candidate);
        if (parent === candidate) return candidate;
        candidate = parent;
    }
}

function isStrictDescendant(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return (
        Boolean(relative) &&
        relative !== ".." &&
        !relative.startsWith(`..${path.sep}`) &&
        !path.isAbsolute(relative)
    );
}

function isWithinOrEqual(parent: string, candidate: string): boolean {
    return (
        path.resolve(parent) === path.resolve(candidate) || isStrictDescendant(parent, candidate)
    );
}

function escapedPublicStaticRoot(root: string): PublicStaticRootInspection {
    return {
        status: "invalid",
        root,
        created: false,
        error: "public_static_dir 的实际目录必须位于配置目录内，已忽略",
    };
}
