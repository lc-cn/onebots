import type { RuntimePluginSelection } from "./runtime-plugin-selection.js";
import { TRUSTED_EXTENSION_CATALOG as EXTENSION_CATALOG } from "./trusted-extension-catalog.js";
import { getExtensionPackageCatalogEntry } from "./extension-capability-catalog.js";
import { listFrameworkProfiles } from "./framework-integration.js";
export interface InstallationPlan {
    selection: RuntimePluginSelection;
    packages: string[];
    peers: string[];
}

export interface InstallationBackend {
    /** 只生成隔离安装请求时，不得宣称依赖已验证。 */
    deferred?: boolean;
    retainedPackages?: string[];
    credentialHint?: string;
    writeRequest?(plan: InstallationPlan): Promise<void>;
    install(
        packages: string[],
        root: string,
        token: string,
        progress?: (message: string) => void,
    ): Promise<void>;
    verify(selection: RuntimePluginSelection, root: string): Promise<void>;
}

export function createInstallationPlan(selection: RuntimePluginSelection): InstallationPlan {
    const packageNames: string[] = [];
    const catalog: Parameters<typeof resolveInstallationPackages>[1] = { packages: {} };
    for (const [type, names] of [
        ["adapter", selection.adapters],
        ["protocol", selection.protocols],
    ] as const) {
        for (const name of names) {
            const entry = EXTENSION_CATALOG.find(item => item.type === type && item.name === name);
            if (!entry) throw new Error(`安装目录中没有 ${type}:${name}`);
            const version = getExtensionPackageCatalogEntry(entry.packageName)?.packageVersion;
            if (!version) throw new Error(`缺少 ${entry.packageName} 的已验证版本`);
            packageNames.push(entry.packageName);
            catalog.packages[entry.packageName] = { version };
        }
    }
    for (const name of selection.applications ?? []) {
        const profile = listFrameworkProfiles().find(item => item.id === name);
        if (!profile) throw new Error(`未知框架方案：${name}`);
        const protocol = profile.protocol.replace(".", "-");
        if (!selection.protocols.includes(protocol))
            throw new Error(`${profile.displayName} 方案需要 ${protocol}，请返回协议选择页勾选`);
    }
    const packages = Object.entries(resolveInstallationPackages(packageNames, catalog)).map(
        ([name, version]) => `${name}@${version}`,
    );
    const peers = packages.flatMap(spec =>
        Object.entries(
            getExtensionPackageCatalogEntry(spec.slice(0, spec.lastIndexOf("@")))
                ?.peerDependencies ?? {},
        ).map(([name, range]) => `${name}@${range}`),
    );
    return { selection, packages: [...new Set(packages)], peers: [...new Set(peers)] };
}

/** Docker 和本机共用的目录解析；已有扩展在镜像升级时重新对齐版本。 */
export function resolveInstallationPackages(
    names: string[],
    catalog: {
        packages: Record<string, { version: string; peerDependencies?: Record<string, string> }>;
    },
    existing: Record<string, string> = {},
): Record<string, string> {
    const requested = { ...existing };
    for (const short of names) {
        const name = short.startsWith("@onebots/") ? short : `@onebots/adapter-${short}`;
        if (!/^@onebots\/(?:adapter|protocol)-[a-z0-9._-]+$/.test(name) || !catalog.packages[name])
            throw new Error(`当前镜像不支持此扩展：${short}`);
        requested[name] = catalog.packages[name].version;
    }
    for (const name of Object.keys(requested)) {
        const entry = catalog.packages[name];
        if (
            !/^@onebots\/(?:adapter|protocol)-[a-z0-9._-]+$/.test(name) ||
            !entry ||
            !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(entry.version)
        )
            throw new Error(`当前镜像缺少 ${name} 的已验证版本`);
        requested[name] = entry.version;
    }
    return requested;
}

/** 认证需求属于安装计划，不由各交互入口重复判断。 */
export function requiresInstallationCredential(
    selection: RuntimePluginSelection,
    retained: string[] = [],
): boolean {
    return selection.adapters.includes("icqq") || retained.includes("@onebots/adapter-icqq");
}

/** 安装与验证的统一状态机；验证重试不会重复安装，凭据不保存在操作对象中。 */
export class InstallationOperation {
    phase: "install" | "verify" | "requested" | "complete" = "install";
    constructor(
        readonly plan: InstallationPlan,
        private readonly backend: InstallationBackend,
        private readonly root: string,
    ) {}
    async run(
        token: string,
        progress?: (message: string) => void,
    ): Promise<"requested" | "complete"> {
        if (this.phase === "requested" || this.phase === "complete") return this.phase;
        if (this.phase === "install") {
            progress?.("安装依赖");
            await this.backend.install(this.plan.packages, this.root, token, progress);
            if (this.backend.deferred) {
                if (!this.backend.writeRequest) throw new Error("隔离后端缺少安装请求写入能力");
                await this.backend.writeRequest(this.plan);
                this.phase = "requested";
                return "requested";
            }
            this.phase = "verify";
        }
        progress?.("验证插件加载与注册");
        await this.backend.verify(this.plan.selection, this.root);
        this.phase = "complete";
        return "complete";
    }
}
