import { createHash } from "node:crypto";
import * as fs from "node:fs";

export type RuntimeConfigSyncStatus = "in_sync" | "drifted" | "unavailable";

export interface RuntimeConfigState {
    status: RuntimeConfigSyncStatus;
    appliedAt: string;
    message: string;
}

/**
 * 只保留配置文件内容的进程内摘要，不向管理面公开摘要或配置内容。
 * 该快照用于证明当前磁盘文件是否仍与最近一次成功应用的来源一致。
 */
export class RuntimeConfigStateTracker {
    private appliedFingerprint: string | null = null;
    private appliedAt = new Date().toISOString();

    constructor(private readonly configPath: string) {
        this.markApplied();
    }

    markApplied(source?: string | Buffer): void {
        this.appliedFingerprint =
            source === undefined ? readFingerprint(this.configPath) : fingerprint(source);
        this.appliedAt = new Date().toISOString();
    }

    inspect(): RuntimeConfigState {
        const currentFingerprint = readFingerprint(this.configPath);
        if (!this.appliedFingerprint || !currentFingerprint) {
            return {
                status: "unavailable",
                appliedAt: this.appliedAt,
                message: "无法读取已应用快照或当前配置文件",
            };
        }
        if (currentFingerprint !== this.appliedFingerprint) {
            return {
                status: "drifted",
                appliedAt: this.appliedAt,
                message: "磁盘配置与当前进程最近应用的版本不一致",
            };
        }
        return {
            status: "in_sync",
            appliedAt: this.appliedAt,
            message: "磁盘配置与当前进程最近应用的版本一致",
        };
    }
}

function readFingerprint(configPath: string): string | null {
    try {
        return fingerprint(fs.readFileSync(configPath));
    } catch {
        // 状态读取本身不能破坏管理 API；调用方通过 unavailable 得到可诊断结果。
        return null;
    }
}

function fingerprint(source: string | Buffer): string {
    return createHash("sha256").update(source).digest("hex");
}
