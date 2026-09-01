import { RouterContext, ValidationError } from "@onebots/core";
import type { Router } from "@onebots/core";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import type { App } from "../app.js";
import { setManagementEvidenceIdentity } from "../management-evidence-identity.js";
import {
    assertManagementInstancePrecondition,
    ManagementInstanceMismatchError,
} from "../management-instance-precondition.js";
import {
    assertPublicStaticRevisionPrecondition,
    capturePublicStaticSnapshot,
    PublicStaticRevisionMismatchError,
    setPublicStaticRevision,
} from "../public-static-snapshot.js";

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
        setManagementEvidenceIdentity(app, ctx);
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
            const snapshot = capturePublicStaticSnapshot(root);
            setPublicStaticRevision(ctx, snapshot.revision);
            ctx.body = {
                success: true,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                static_revision: snapshot.revision,
                files: snapshot.files,
                root,
            };
        } catch (error) {
            ctx.status = 500;
            ctx.body = publicStaticFailure(app, error);
            app.logger.error("管理端读取静态文件列表失败", { error });
        }
    });

    router.post("/api/public-static/upload", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
        const file = pickPublicStaticUpload(
            ctx.request.files as Record<string, unknown> | undefined,
        );
        const tmpPath = file?.filepath;
        const root = app.getPublicStaticRoot();
        if (!root) {
            removeUploadedTemporaryFile(app, tmpPath);
            ctx.status = 400;
            ctx.body = {
                success: false,
                message: "请先在基础配置中设置 public_static_dir 并保存配置",
            };
            return;
        }

        if (!tmpPath) {
            ctx.status = 400;
            ctx.body = { success: false, message: "缺少上传文件（字段名 file）" };
            return;
        }

        try {
            assertManagementInstancePrecondition(app, ctx, "静态文件上传");
            assertPublicStaticRevisionPrecondition(ctx, root, "静态文件上传");
            const safeName = sanitizePublicStaticBasename(
                file.originalFilename ?? file.newFilename,
            );
            if (!safeName) throw new ValidationError("非法或无法识别的文件名");
            replacePublicStaticFile(root, tmpPath, safeName);
            const hf = await app.backupDataDirToHfAfterStaticChange();
            const snapshot = capturePublicStaticSnapshot(root);
            setPublicStaticRevision(ctx, snapshot.revision);
            ctx.body = {
                success: true,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                static_revision: snapshot.revision,
                message: "上传成功",
                filename: safeName,
                ...(hf.attempted ? { hf_backup: hf } : {}),
            };
        } catch (error) {
            ctx.status = publicStaticMutationStatus(error);
            ctx.body = publicStaticFailure(app, error);
            app.logger.error("管理端上传静态文件失败", { error });
        } finally {
            removeUploadedTemporaryFile(app, tmpPath);
        }
    });

    router.delete("/api/public-static/:filename", async (ctx: RouterContext) => {
        setManagementEvidenceIdentity(app, ctx);
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
            assertManagementInstancePrecondition(app, ctx, "静态文件删除");
            assertPublicStaticRevisionPrecondition(ctx, root, "静态文件删除");
            const safeName = sanitizePublicStaticBasename(ctx.params.filename ?? "");
            if (!safeName) throw new ValidationError("非法文件名");
            const resolvedRoot = path.resolve(root);
            const target = path.join(root, safeName);
            const rel = path.relative(resolvedRoot, path.resolve(target));
            if (rel.startsWith("..") || path.isAbsolute(rel) || rel === "") {
                throw new ValidationError("路径非法");
            }
            if (!fs.existsSync(target)) {
                ctx.status = 404;
                ctx.body = publicStaticFailure(app, new Error("文件不存在"));
                return;
            }
            if (!fs.lstatSync(target).isFile()) {
                ctx.status = 409;
                ctx.body = publicStaticFailure(
                    app,
                    new Error("目标名称已被符号链接、目录或其他非常规文件占用"),
                );
                return;
            }
            fs.unlinkSync(target);
            const hf = await app.backupDataDirToHfAfterStaticChange();
            const snapshot = capturePublicStaticSnapshot(root);
            setPublicStaticRevision(ctx, snapshot.revision);
            ctx.body = {
                success: true,
                application: app.info.application_name,
                instance_id: app.info.instance_id,
                static_revision: snapshot.revision,
                message: "已删除",
                ...(hf.attempted ? { hf_backup: hf } : {}),
            };
        } catch (error) {
            ctx.status = publicStaticMutationStatus(error);
            ctx.body = publicStaticFailure(app, error);
            app.logger.error("管理端删除静态文件失败", { error });
        }
    });
}

function publicStaticMutationStatus(error: unknown): number {
    if (
        error instanceof ManagementInstanceMismatchError ||
        error instanceof PublicStaticRevisionMismatchError ||
        error instanceof UnsafePublicStaticTargetError
    ) {
        return 409;
    }
    if (error instanceof ValidationError) return 400;
    return 500;
}

function publicStaticFailure(app: App, error: unknown) {
    return {
        success: false,
        application: app.info.application_name,
        instance_id: app.info.instance_id,
        message: error instanceof Error ? error.message : String(error),
    };
}

function removeUploadedTemporaryFile(app: App, filepath: string | undefined): void {
    if (!filepath) return;
    try {
        fs.unlinkSync(filepath);
    } catch (error) {
        // koa-body 可能已移除临时文件；其他清理错误也不能覆盖原始管理响应。
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
            app.logger.error("管理端清理静态文件上传临时文件失败", { error });
        }
    }
}
