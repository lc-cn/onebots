import * as fs from "node:fs";
import * as path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { BaseApp, writeConfigFileAtomic, yaml } from "@onebots/core";
import { EXTENSION_CATALOG, getExtensionCatalogEntry } from "./extension-catalog.js";
import {
    getRuntimePluginSelection,
    setRuntimePluginSelection,
} from "./runtime-plugin-selection.js";
import { parseRuntimeConfig } from "./runtime-config-validator.js";
import type { LoadedPluginInfo } from "./plugin-loader.js";

const execFileAsync = promisify(execFile);

export interface ExtensionInstaller {
    install(packageName: string, runtimeRoot: string): Promise<void>;
}

class NpmExtensionInstaller implements ExtensionInstaller {
    async install(packageName: string, runtimeRoot: string): Promise<void> {
        await execFileAsync(
            process.platform === "win32" ? "npm.cmd" : "npm",
            ["install", "--save", "--omit=dev", `${packageName}@latest`],
            { cwd: runtimeRoot, timeout: 10 * 60 * 1000, maxBuffer: 4 * 1024 * 1024 },
        );
    }
}

export interface ExtensionManagerOptions {
    runtimeRoot?: string;
    configPath?: string;
    installer?: ExtensionInstaller;
}

export class ExtensionNotFoundError extends Error {}
export class ExtensionInstallConflictError extends Error {}

/** 白名单扩展的安装、启用和运行态查询。 */
export class ExtensionManager {
    private readonly runtimeRoot: string;
    private readonly configPath: string;
    private readonly installer: ExtensionInstaller;
    private installing: string | null = null;

    constructor(options: ExtensionManagerOptions = {}) {
        this.runtimeRoot = path.resolve(
            options.runtimeRoot ?? process.env.ONEBOTS_EXTENSION_ROOT ?? process.cwd(),
        );
        this.configPath = options.configPath ?? BaseApp.configPath;
        this.installer = options.installer ?? new NpmExtensionInstaller();
    }

    list(loadedPlugins: readonly LoadedPluginInfo[]) {
        const selection = this.readSelection();
        return EXTENSION_CATALOG.map(entry => ({
            ...entry,
            installed: this.isInstalled(entry.packageName),
            enabled: (entry.type === "adapter" ? selection.adapters : selection.protocols).includes(
                entry.name,
            ),
            loaded: loadedPlugins.some(
                plugin => plugin.type === entry.type && plugin.name === entry.name,
            ),
            installing: this.installing === entry.id,
        }));
    }

    async install(id: string): Promise<{ restartRequired: true }> {
        const entry = getExtensionCatalogEntry(id);
        if (!entry) throw new ExtensionNotFoundError("扩展不存在或不允许从管理端安装");
        if (this.installing) {
            throw new ExtensionInstallConflictError(`扩展 ${this.installing} 正在安装，请稍后再试`);
        }
        this.assertRuntimeRoot();
        this.installing = id;
        try {
            if (!this.isInstalled(entry.packageName)) {
                await this.installer.install(entry.packageName, this.runtimeRoot);
            }
            const source = fs.readFileSync(this.configPath, "utf8");
            const config = parseRuntimeConfig(source);
            const selection = getRuntimePluginSelection(config) ?? { adapters: [], protocols: [] };
            const key = entry.type === "adapter" ? "adapters" : "protocols";
            if (!selection[key].includes(entry.name)) selection[key].push(entry.name);
            setRuntimePluginSelection(config, selection);
            writeConfigFileAtomic(this.configPath, yaml.dump(config, { noRefs: true }), {
                backup: true,
            });
            return { restartRequired: true };
        } finally {
            this.installing = null;
        }
    }

    private readSelection() {
        if (!fs.existsSync(this.configPath)) return { adapters: [], protocols: [] };
        const config = parseRuntimeConfig(fs.readFileSync(this.configPath, "utf8"));
        return getRuntimePluginSelection(config) ?? { adapters: [], protocols: [] };
    }

    private isInstalled(packageName: string): boolean {
        const parts = packageName.split("/");
        return fs.existsSync(path.join(this.runtimeRoot, "node_modules", ...parts, "package.json"));
    }

    private assertRuntimeRoot(): void {
        const manifest = path.join(this.runtimeRoot, "package.json");
        if (!fs.existsSync(manifest)) {
            throw new Error(
                `扩展运行目录缺少 package.json：${this.runtimeRoot}。请使用官方安装脚本部署，或设置 ONEBOTS_EXTENSION_ROOT。`,
            );
        }
    }
}
