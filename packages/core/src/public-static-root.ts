import * as fs from "node:fs";
import * as path from "node:path";
import type { Logger } from "./logger.js";

/** 解析并准备受约束的站点根静态目录。 */
export function resolvePublicStaticRoot(
    configDir: string,
    configured: string | undefined,
    logger: Logger,
): string | null {
    const value = configured?.trim();
    if (!value) return null;

    const root = path.resolve(configDir);
    const absolute = path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
    if (!path.isAbsolute(value)) {
        const relative = path.relative(root, absolute);
        if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
            logger.warn("public_static_dir 必须为配置目录下的子目录，已忽略", {
                configured: value,
                resolved: absolute,
                configDir: root,
            });
            return null;
        }
    }

    try {
        fs.mkdirSync(absolute, { recursive: true });
        const resolved = fs.realpathSync(absolute);
        if (!fs.statSync(resolved).isDirectory()) {
            logger.warn("public_static_dir 不是目录，已忽略", { absolute });
            return null;
        }
        if (!path.isAbsolute(value)) {
            const resolvedConfigDir = fs.realpathSync(root);
            const relative = path.relative(resolvedConfigDir, resolved);
            if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
                logger.warn("public_static_dir 的实际目录必须位于配置目录内，已忽略", {
                    configured: value,
                    resolved,
                    configDir: resolvedConfigDir,
                });
                return null;
            }
        }
        return resolved;
    } catch (error) {
        logger.warn("public_static_dir 无法创建或访问，静态托管已跳过", {
            absolute,
            error,
        });
        return null;
    }
}
