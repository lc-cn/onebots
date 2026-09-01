import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
    getExtensionPackageCatalogEntry,
    getExtensionPackageCatalogNames,
} from "./extension-capability-catalog.js";
import { readBoundedResponseBody } from "./bounded-response.js";

export const HF_DATA_ARCHIVE_LIMIT_BYTES = 15 * 1024 * 1024;
export const HF_DATA_ARCHIVE_TIMEOUT_MS = 30_000;
export const HF_DATA_EXPANDED_LIMIT_BYTES = 128 * 1024 * 1024;
export const HF_DATA_ENTRY_LIMIT = 10_000;
const HF_DATA_ENTRY_PATH_LIMIT_BYTES = 1024;
const HF_UPLOAD_TIMEOUT_MS = 60_000;
const HF_ERROR_RESPONSE_LIMIT_BYTES = 64 * 1024;
const EXTENSION_MANIFEST_LIMIT_BYTES = 1024 * 1024;

interface MinimalLogger {
    warn?(...args: unknown[]): void;
}

interface HfBackupFile {
    path: string;
    content: string;
    encoding?: "utf-8" | "base64";
}

export interface HfExtensionRecovery {
    schemaVersion: 1;
    packages: Record<string, string>;
}

export interface HfBackupResult {
    success: boolean;
    message?: string;
    dataArchiveIncluded?: boolean;
}

interface HfBackupDependencies {
    archiveData(directory: string, timeoutMs: number): Buffer;
    createUploadSignal(timeoutMs: number): AbortSignal;
    fetcher: typeof fetch;
}

const defaultDependencies: HfBackupDependencies = {
    archiveData: (directory, timeoutMs) =>
        execFileSync(
            "tar",
            [
                "-czf",
                "-",
                "--exclude=./extensions/node_modules",
                "--exclude=./extensions/.pnpm-store",
                "--exclude=./extensions/package.json",
                "--exclude=./extensions/pnpm-lock.yaml",
                "-C",
                directory,
                ".",
            ],
            {
                encoding: "buffer",
                maxBuffer: HF_DATA_ARCHIVE_LIMIT_BYTES,
                timeout: timeoutMs,
            },
        ) as Buffer,
    createUploadSignal: timeoutMs => AbortSignal.timeout(timeoutMs),
    fetcher: fetch,
};

export class HfBackupService {
    private readonly dependencies: HfBackupDependencies;

    constructor(
        private logger: MinimalLogger,
        private readonly configDir: string,
        private readonly configPath: string,
        dependencies: Partial<HfBackupDependencies> = {},
    ) {
        this.dependencies = { ...defaultDependencies, ...dependencies };
    }

    async backupData(configContent: string): Promise<HfBackupResult> {
        const hfToken = process.env.HF_TOKEN;
        const hfRepoId = process.env.HF_REPO_ID;
        if (!hfToken || !hfRepoId || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(hfRepoId)) {
            return { success: false, message: "未配置 HF_TOKEN 或 HF_REPO_ID" };
        }
        const [namespace, repo] = hfRepoId.split("/");
        try {
            const recovery = buildHfExtensionRecovery(this.configDir);
            const files: HfBackupFile[] = [
                { path: "config_backup.yaml", content: configContent },
                {
                    path: "extensions_backup.json",
                    content: `${JSON.stringify(recovery, null, 2)}\n`,
                },
            ];
            let archiveIncluded = false;
            if (fs.existsSync(this.configDir)) {
                try {
                    assertHfBackupTreeRestorable(this.configDir);
                    const tarBuffer = this.dependencies.archiveData(
                        this.configDir,
                        HF_DATA_ARCHIVE_TIMEOUT_MS,
                    );
                    if (tarBuffer.length > 0) {
                        files.push({
                            path: "data_backup.tar.gz",
                            content: tarBuffer.toString("base64"),
                            encoding: "base64",
                        });
                        archiveIncluded = true;
                    }
                } catch (error) {
                    this.logger?.warn?.(
                        "完整数据归档超过限制或生成失败，改为备份配置与扩展恢复清单",
                        { error },
                    );
                }
            }
            if (!archiveIncluded) {
                files.push({ path: "data_backup.tar.gz", content: "", encoding: "base64" });
            }

            const response = await this.dependencies.fetcher(
                `https://huggingface.co/api/spaces/${namespace}/${repo}/commit/main`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${hfToken}`,
                    },
                    body: JSON.stringify({ summary: "onebots data backup", files }),
                    signal: this.dependencies.createUploadSignal(HF_UPLOAD_TIMEOUT_MS),
                },
            );
            if (!response.ok) {
                const text = await readBoundedResponseBody(response, HF_ERROR_RESPONSE_LIMIT_BYTES);
                this.logger?.warn?.("备份到 HF 仓库失败:", response.status, text);
                return { success: false, message: `备份失败: ${response.status} ${text}` };
            }
            return {
                success: true,
                dataArchiveIncluded: archiveIncluded,
                message: archiveIncluded
                    ? "已备份配置、扩展恢复清单和数据归档"
                    : "已备份配置和扩展恢复清单；完整数据归档超过限制或生成失败",
            };
        } catch (error) {
            const message = hfBackupErrorMessage(error);
            this.logger?.warn?.("备份到 HF 仓库异常:", error);
            return { success: false, message };
        }
    }

    async backupAfterStaticChange(): Promise<
        | { attempted: false }
        | {
              attempted: true;
              success: boolean;
              message?: string;
              dataArchiveIncluded?: boolean;
          }
    > {
        const hfToken = process.env.HF_TOKEN;
        const hfRepoId = process.env.HF_REPO_ID;
        if (!hfToken || !hfRepoId || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(hfRepoId)) {
            return { attempted: false };
        }
        try {
            const configContent = fs.readFileSync(this.configPath, "utf8");
            const result = await this.backupData(configContent);
            if (!result.success && result.message) {
                this.logger?.warn?.(`Hugging Face 备份（站点静态变更后）: ${result.message}`);
            }
            return { attempted: true, ...result };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger?.warn?.("Hugging Face 备份（站点静态变更后）异常:", error);
            return { attempted: true, success: false, message };
        }
    }
}

export function buildHfExtensionRecovery(configDirectory: string): HfExtensionRecovery {
    const manifestPath = path.join(configDirectory, "extensions", "package.json");
    if (!fs.existsSync(manifestPath)) return { schemaVersion: 1, packages: {} };
    const stat = fs.lstatSync(manifestPath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error(`HF 扩展恢复清单来源不是常规文件: ${manifestPath}`);
    }
    if (stat.size > EXTENSION_MANIFEST_LIMIT_BYTES) {
        throw new Error(
            `HF 扩展恢复清单来源超过 ${EXTENSION_MANIFEST_LIMIT_BYTES} 字节上限: ${manifestPath}`,
        );
    }
    const parsed: unknown = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    if (
        !isRecord(parsed) ||
        (parsed.dependencies !== undefined && !isRecord(parsed.dependencies))
    ) {
        throw new Error(`HF 扩展恢复清单来源 dependencies 不是对象: ${manifestPath}`);
    }
    const dependencies = isRecord(parsed.dependencies) ? parsed.dependencies : {};
    const packages: Record<string, string> = {};
    for (const packageName of getExtensionPackageCatalogNames()) {
        const declared = dependencies[packageName];
        if (typeof declared !== "string" || declared.startsWith("link:")) continue;
        const catalogEntry = getExtensionPackageCatalogEntry(packageName);
        if (catalogEntry) packages[packageName] = catalogEntry.packageVersion;
    }
    return { schemaVersion: 1, packages };
}

export function assertHfBackupTreeRestorable(configDirectory: string): void {
    const rootStat = fs.lstatSync(configDirectory);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
        throw new Error(`HF 数据备份根目录不是常规目录: ${configDirectory}`);
    }
    let entries = 0;
    let bytes = 0;
    const visit = (directory: string, relativeDirectory: string): void => {
        for (const name of fs.readdirSync(directory)) {
            const relative = relativeDirectory ? `${relativeDirectory}/${name}` : name;
            if (isExcludedHfBackupEntry(relative)) continue;
            if (Buffer.byteLength(relative) > HF_DATA_ENTRY_PATH_LIMIT_BYTES) {
                throw new Error(
                    `HF 数据备份条目路径超过 ${HF_DATA_ENTRY_PATH_LIMIT_BYTES} 字节上限`,
                );
            }
            if (/[\0-\x1f\x7f]/u.test(relative)) {
                throw new Error(`HF 数据备份路径包含控制字符: ${relative}`);
            }
            if (relative.startsWith(".hf-restore-")) {
                throw new Error(`HF 数据备份占用内部暂存路径: ${relative}`);
            }
            const absolute = path.join(directory, name);
            const stat = fs.lstatSync(absolute);
            entries++;
            if (entries > HF_DATA_ENTRY_LIMIT) {
                throw new Error(`HF 数据备份超过 ${HF_DATA_ENTRY_LIMIT} 个条目上限`);
            }
            if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
                throw new Error(`HF 数据备份包含链接或特殊条目: ${relative}`);
            }
            if (stat.isDirectory()) {
                visit(absolute, relative);
                continue;
            }
            if (stat.nlink !== 1) throw new Error(`HF 数据备份包含硬链接条目: ${relative}`);
            bytes += stat.size;
            if (bytes > HF_DATA_EXPANDED_LIMIT_BYTES) {
                throw new Error("HF 数据备份展开大小超过 128 MiB 上限");
            }
        }
    };
    visit(configDirectory, "");
}

function isExcludedHfBackupEntry(relative: string): boolean {
    return (
        relative === "extensions/node_modules" ||
        relative.startsWith("extensions/node_modules/") ||
        relative === "extensions/.pnpm-store" ||
        relative.startsWith("extensions/.pnpm-store/") ||
        relative === "extensions/package.json" ||
        relative === "extensions/pnpm-lock.yaml"
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hfBackupErrorMessage(error: unknown): string {
    if (error instanceof DOMException && error.name === "TimeoutError") {
        return `HF 仓库上传超过 ${HF_UPLOAD_TIMEOUT_MS / 1000} 秒，已取消`;
    }
    return error instanceof Error ? error.message : String(error);
}
