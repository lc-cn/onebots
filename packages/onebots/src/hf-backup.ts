import { existsSync, readFileSync } from "fs";
import { execFileSync } from "node:child_process";

interface MinimalLogger {
    warn?(...args: unknown[]): void;
}

export class HfBackupService {
    constructor(
        private logger: MinimalLogger,
        private readonly configDir: string,
        private readonly configPath: string,
    ) {}

    async backupData(configContent: string): Promise<{ success: boolean; message?: string }> {
        const hfToken = process.env.HF_TOKEN;
        const hfRepoId = process.env.HF_REPO_ID;
        if (!hfToken || !hfRepoId || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(hfRepoId)) {
            return { success: false, message: "未配置 HF_TOKEN 或 HF_REPO_ID" };
        }
        const [namespace, repo] = hfRepoId.split("/");
        const files: { path: string; content: string; encoding?: "utf-8" | "base64" }[] = [
            { path: "config_backup.yaml", content: configContent },
        ];
        try {
            const dataDir = this.configDir;
            if (existsSync(dataDir)) {
                const tarBuf = execFileSync("tar", ["-czf", "-", "-C", dataDir, "."], {
                    encoding: "buffer",
                    maxBuffer: 15 * 1024 * 1024,
                }) as Buffer;
                if (tarBuf.length > 0) {
                    files.push({
                        path: "data_backup.tar.gz",
                        content: tarBuf.toString("base64"),
                        encoding: "base64",
                    });
                }
            }
            const res = await fetch(
                `https://huggingface.co/api/spaces/${namespace}/${repo}/commit/main`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "Authorization": `Bearer ${hfToken}`,
                    },
                    body: JSON.stringify({ summary: "onebots data backup", files }),
                },
            );
            if (!res.ok) {
                const text = await res.text();
                this.logger?.warn?.("备份到 HF 仓库失败:", res.status, text);
                return { success: false, message: `备份失败: ${res.status} ${text}` };
            }
            return { success: true };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger?.warn?.("备份到 HF 仓库异常:", error);
            return { success: false, message };
        }
    }

    async backupAfterStaticChange(): Promise<
        { attempted: false } | { attempted: true; success: boolean; message?: string }
    > {
        const hfToken = process.env.HF_TOKEN;
        const hfRepoId = process.env.HF_REPO_ID;
        if (!hfToken || !hfRepoId || !/^[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+$/.test(hfRepoId)) {
            return { attempted: false };
        }
        try {
            const configContent = readFileSync(this.configPath, "utf8");
            const r = await this.backupData(configContent);
            if (!r.success && r.message) {
                this.logger?.warn?.(`Hugging Face 备份（站点静态变更后）: ${r.message}`);
            }
            return { attempted: true, success: r.success, message: r.message };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.logger?.warn?.("Hugging Face 备份（站点静态变更后）异常:", error);
            return { attempted: true, success: false, message };
        }
    }
}
