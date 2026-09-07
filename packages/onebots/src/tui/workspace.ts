import * as fs from "node:fs";
import * as path from "node:path";
import yaml from "js-yaml";
import { ConfigValidator, writeConfigFileAtomic } from "@onebots/core";
import { getAppConfigSchema } from "../config-schema.js";
import { parseRuntimeConfig, validateRuntimeConfig } from "../runtime-config-validator.js";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
    type RuntimePluginSelection,
} from "../runtime-plugin-selection.js";
import { ensureManagementCredentials } from "../management-credentials.js";
import { ensureRuntimeDataDirectory } from "../runtime-data-directory.js";
import { createBaseSetupConfig } from "../setup-config.js";

export const TERMINAL_PAGES = [
    { id: "overview", label: "概览" },
    { id: "extensions", label: "扩展" },
    { id: "accounts", label: "账号" },
    { id: "protocols", label: "协议" },
    { id: "frameworks", label: "框架" },
    { id: "service", label: "运行" },
    { id: "settings", label: "设置" },
] as const;
export type TerminalPage = (typeof TERMINAL_PAGES)[number]["id"];

export interface WorkspaceSummary {
    configured: boolean;
    dirty: boolean;
    needsRestart: boolean;
    conflict: boolean;
    error?: string;
    adapters: string[];
    protocols: string[];
    frameworks: string[];
    accounts: string[];
    changes: string[];
}

/** 所有页面编辑同一份内存草稿。只有提交会修改配置，导航与取消不丢弃草稿。 */
export class TerminalWorkspace {
    private source: string | undefined;
    private saved: Record<string, unknown> = createBaseSetupConfig();
    private draft: Record<string, unknown> = createBaseSetupConfig();
    private error?: string;
    private conflict = false;
    needsRestart = false;

    constructor(
        readonly configPath: string,
        readonly root: string,
    ) {
        this.reload();
    }

    get config(): Record<string, unknown> {
        return structuredClone(this.draft);
    }
    get selection(): RuntimePluginSelection {
        return (
            getRuntimePluginSelection(this.draft) ?? {
                adapters: [],
                protocols: [],
                applications: [],
            }
        );
    }
    get dirty(): boolean {
        return JSON.stringify(this.saved) !== JSON.stringify(this.draft);
    }
    update(config: Record<string, unknown>): void {
        this.draft = structuredClone(config);
    }
    select(selection: RuntimePluginSelection): void {
        setRuntimePluginSelection(this.draft, selection);
    }

    snapshot(): { source?: string; draft: Record<string, unknown> } {
        return { source: this.source, draft: this.config };
    }
    resume(snapshot: { source?: string; draft: Record<string, unknown> }): void {
        getRuntimePluginSelection(snapshot.draft);
        this.update(snapshot.draft);
        this.conflict = snapshot.source !== this.readSource();
    }

    reload(): void {
        try {
            this.source = this.readSource();
            this.saved =
                this.source === undefined
                    ? createBaseSetupConfig()
                    : parseRuntimeConfig(this.source);
            // 同时验证插件选择结构，损坏配置也必须能进入工作台修复。
            getRuntimePluginSelection(this.saved);
            this.draft = structuredClone(this.saved);
            this.error = undefined;
            this.conflict = false;
        } catch {
            this.error = "配置无法读取。可在设置中恢复备份，或修复文件后重新载入。";
        }
    }

    sync(): void {
        try {
            if (this.readSource() !== this.source) {
                if (this.dirty) this.conflict = true;
                else this.reload();
            }
        } catch {
            this.error = "配置暂时无法读取，请检查文件权限后重新载入。";
        }
    }

    restoreBackup(): void {
        const candidate = parseRuntimeConfig(fs.readFileSync(`${this.configPath}.bak`, "utf8"));
        getRuntimePluginSelection(candidate);
        this.source = this.readSource();
        this.draft = candidate;
        this.error = undefined;
        this.conflict = false;
    }

    summary(): WorkspaceSummary {
        const selection = this.selection;
        return {
            configured: this.source !== undefined,
            dirty: this.dirty,
            needsRestart: this.needsRestart,
            conflict: this.conflict,
            error: this.error,
            adapters: selection.adapters,
            protocols: selection.protocols,
            frameworks: selection.applications ?? [],
            accounts: Object.keys(this.draft).filter(key => /^[^.]+\..+$/u.test(key)),
            changes: [...new Set([...Object.keys(this.saved), ...Object.keys(this.draft)])].filter(
                key => JSON.stringify(this.saved[key]) !== JSON.stringify(this.draft[key]),
            ),
        };
    }

    commit(): void {
        if (this.error) throw new Error(this.error);
        if (this.conflict || this.readSource() !== this.source)
            throw new Error("配置已被其他操作更新。草稿已保留，请在设置中重新载入后再修改。");
        const config = ensureManagementCredentials(this.draft).config;
        // 注册表在工作台内可能留有先前加载的模块；持久化选择必须覆盖所有账号引用。
        const selection = this.selection;
        for (const account of this.summary().accounts) {
            const platform = account.slice(0, account.indexOf("."));
            if (!selection.adapters.includes(platform))
                throw new Error(`${account} 仍引用 ${platform}，请保留该扩展或先删除账号。`);
            const value = config[account];
            if (value && typeof value === "object" && !Array.isArray(value)) {
                for (const key of Object.keys(value)) {
                    if (
                        getAppConfigSchema().protocols[key] &&
                        !selection.protocols.includes(key.replace(".", "-"))
                    )
                        throw new Error(`${account} 仍启用 ${key}，请保留协议或先禁用出口。`);
                }
            }
        }
        ConfigValidator.validate(config, getAppConfigSchema().base);
        validateRuntimeConfig(config);
        fs.mkdirSync(path.dirname(this.configPath), { recursive: true });
        ensureRuntimeDataDirectory(path.join(path.dirname(this.configPath), "data"));
        const content = yaml.dump(config, { noRefs: true });
        writeConfigFileAtomic(this.configPath, content, {
            backup: this.source !== undefined,
            mode: 0o600,
        });
        if (this.readSource() !== content) throw new Error("配置写入后发生变化，请重新载入检查");
        this.source = content;
        this.saved = structuredClone(config);
        this.draft = structuredClone(config);
        this.needsRestart = true;
    }

    private readSource(): string | undefined {
        try {
            return fs.readFileSync(this.configPath, "utf8");
        } catch (error) {
            if (error instanceof Error && "code" in error && error.code === "ENOENT")
                return undefined;
            throw error;
        }
    }
}

export function nextWorkspaceStep(summary: WorkspaceSummary): {
    page: TerminalPage;
    label: string;
} {
    if (summary.error || summary.conflict) return { page: "settings", label: "修复配置" };
    if (!summary.adapters.length || !summary.protocols.length)
        return { page: "extensions", label: "选择平台和输出协议" };
    if (!summary.accounts.length) return { page: "accounts", label: "添加第一个机器人账号" };
    if (summary.dirty || summary.needsRestart || !summary.configured)
        return { page: "service", label: "保存并启动，验证运行状态" };
    return { page: "service", label: "查看运行状态" };
}
