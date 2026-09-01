import { RouterContext } from "@onebots/core";
import type { Router } from "@onebots/core";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "../app.js";

/* ── internal helpers ─────────────────────────────────────────── */

type PublicStaticUploadedFile = {
    filepath?: string;
    originalFilename?: string | null;
    newFilename?: string | null;
};

/** 站点静态根目录下的文件名：禁止路径分隔与控制字符，仅使用 basename */
function sanitizePublicStaticBasename(original: string | null | undefined): string | null {
    if (original == null || String(original).trim() === "") return null;
    let raw = String(original).trim();
    try {
        raw = decodeURIComponent(raw);
    } catch {
        return null;
    }
    if (/[\\/]/.test(raw) || raw.includes("..")) return null;
    if (/[\x00-\x1f]/.test(raw)) return null;
    const base = path.basename(raw);
    if (!base || base !== raw || base === "." || base === "..") return null;
    if (Buffer.byteLength(base) > 255) return null;
    return base;
}

function pickPublicStaticUpload(
    files: Record<string, unknown> | undefined,
): PublicStaticUploadedFile | null {
    if (!files || typeof files !== "object") return null;
    const raw = files.file ?? files.upload;
    if (!raw) return null;
    const file = Array.isArray(raw) ? raw[0] : raw;
    if (!file || typeof file !== "object") return null;
    return file as PublicStaticUploadedFile;
}

class UnsafePublicStaticTargetError extends Error {}

function inspectReplaceablePublicStaticTarget(target: string): number | null {
    try {
        const stats = fs.lstatSync(target);
        if (!stats.isFile()) {
            throw new UnsafePublicStaticTargetError(
                "目标名称已被符号链接、目录或其他非常规文件占用",
            );
        }
        return stats.mode & 0o777;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw error;
    }
}

/** 在静态根内完成同文件系统原子替换，避免跟随最终路径上的符号链接。 */
function replacePublicStaticFile(root: string, source: string, filename: string): void {
    const target = path.join(root, filename);
    const temporary = path.join(root, `.${filename}.${randomUUID()}.tmp`);
    try {
        fs.copyFileSync(source, temporary, fs.constants.COPYFILE_EXCL);
        const existingMode = inspectReplaceablePublicStaticTarget(target);
        if (existingMode !== null) fs.chmodSync(temporary, existingMode);
        fs.renameSync(temporary, target);
    } finally {
        try {
            fs.unlinkSync(temporary);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
    }
}

/**
 * Register public-static file management routes.
 *
 * Routes:
 *  GET    /api/public-static/files     — list files in public_static_dir
 *  POST   /api/public-static/upload    — upload a file
 *  DELETE /api/public-static/:filename — delete a file
 */
export function registerPublicStaticRoutes(app: App, router: Router): void {
    router.get("/api/public-static/files", (ctx: RouterContext) => {
        const root = app.getPublicStaticRoot();
        if (!root) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                message: "请先在基础配置中设置 public_static_dir 并保存配置",
            };
            return;
        }
        try {
            const names = fs
                .readdirSync(root, { withFileTypes: true })
                .filter(d => d.isFile())
                .map(d => d.name)
                .sort((a, b) => a.localeCompare(b));
            ctx.body = { success: true, files: names, root };
        } catch (error) {
            ctx.status = 500;
            ctx.body = { success: false, message: (error as Error).message };
        }
    });

    router.post("/api/public-static/upload", async (ctx: RouterContext) => {
        const root = app.getPublicStaticRoot();
        if (!root) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                message: "请先在基础配置中设置 public_static_dir 并保存配置",
            };
            return;
        }

        const file = pickPublicStaticUpload(
            ctx.request.files as Record<string, unknown> | undefined,
        );
        if (!file?.filepath) {
            ctx.status = 400;
            ctx.body = { success: false, message: "缺少上传文件（字段名 file）" };
            return;
        }

        const safeName = sanitizePublicStaticBasename(file.originalFilename ?? file.newFilename);
        if (!safeName) {
            try {
                fs.unlinkSync(file.filepath);
            } catch {
                /* 忽略临时文件清理失败 */
            }
            ctx.status = 400;
            ctx.body = { success: false, message: "非法或无法识别的文件名" };
            return;
        }

        const tmpPath = file.filepath;
        try {
            replacePublicStaticFile(root, tmpPath, safeName);
            ctx.body = { success: true, message: "上传成功", filename: safeName };
            const hf = await app.backupDataDirToHfAfterStaticChange();
            if (hf.attempted) {
                (ctx.body as { hf_backup?: typeof hf }).hf_backup = hf;
            }
        } catch (error) {
            ctx.status = error instanceof UnsafePublicStaticTargetError ? 409 : 500;
            ctx.body = { success: false, message: (error as Error).message };
        } finally {
            try {
                fs.unlinkSync(tmpPath);
            } catch {
                /* 忽略 */
            }
        }
    });

    router.delete("/api/public-static/:filename", async (ctx: RouterContext) => {
        const root = app.getPublicStaticRoot();
        if (!root) {
            ctx.status = 400;
            ctx.body = {
                success: false,
                message: "请先在基础配置中设置 public_static_dir 并保存配置",
            };
            return;
        }

        const safeName = sanitizePublicStaticBasename(ctx.params.filename ?? "");
        if (!safeName) {
            ctx.status = 400;
            ctx.body = { success: false, message: "非法文件名" };
            return;
        }

        const resolvedRoot = path.resolve(root);
        const target = path.join(root, safeName);
        const rel = path.relative(resolvedRoot, path.resolve(target));
        if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
            ctx.status = 400;
            ctx.body = { success: false, message: "路径非法" };
            return;
        }

        try {
            if (!fs.existsSync(target)) {
                ctx.status = 404;
                ctx.body = { success: false, message: "文件不存在" };
                return;
            }
            if (!fs.lstatSync(target).isFile()) {
                ctx.status = 409;
                ctx.body = {
                    success: false,
                    message: "目标名称已被符号链接、目录或其他非常规文件占用",
                };
                return;
            }
            fs.unlinkSync(target);
            ctx.body = { success: true, message: "已删除" };
            const hf = await app.backupDataDirToHfAfterStaticChange();
            if (hf.attempted) {
                (ctx.body as { hf_backup?: typeof hf }).hf_backup = hf;
            }
        } catch (error) {
            ctx.status = 500;
            ctx.body = { success: false, message: (error as Error).message };
        }
    });
}
