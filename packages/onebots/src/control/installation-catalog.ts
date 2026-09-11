import type { ControlInstallationCatalog } from "@onebots/core/control";
import { summarizeManifest } from "../capability-report.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "../extension-capability-catalog.js";
import { listFrameworkProfiles } from "../framework-integration.js";
import type { GenerationResolverConfig } from "../installation/generation-resolver.js";
import type { GenerationSelection } from "../installation/generation-plan.js";
import type { GenerationStore } from "../installation/generation-store.js";
import { TRUSTED_EXTENSION_CATALOG } from "../trusted-extension-catalog.js";
import { activeInstallationResolver } from "./installation-active-resolver.js";

const BUILTIN_APPLICATIONS = listFrameworkProfiles()
    .filter(profile => String(profile.applicationStage) !== "planned")
    .map(profile => Object.freeze({ name: profile.id, displayName: profile.displayName }));

export interface ControlInstallationCatalogOptions {
    store: GenerationStore;
    resolver: GenerationResolverConfig;
    currentGenerationId?(): string | null;
    currentSelection?(): GenerationSelection;
}

/** 只读产品目录；不创建安装记录，也不要求管理进程拥有运行时修改权限。 */
export class ControlInstallationCatalogReader {
    constructor(private readonly options: ControlInstallationCatalogOptions) {}

    catalog(): ControlInstallationCatalog {
        const activeGenerationId = this.options.currentGenerationId?.() ?? null;
        const resolver = activeInstallationResolver(
            this.options.store,
            activeGenerationId,
            this.options.resolver,
        );
        const entries = (type: "adapter" | "protocol") =>
            TRUSTED_EXTENSION_CATALOG.filter(entry => entry.type === type).flatMap(entry => {
                const version = resolver.extensionVersions
                    ? resolver.extensionVersions[entry.packageName]
                    : getExtensionPackageCatalogEntry(entry.packageName)?.packageVersion;
                return version
                    ? [{ name: entry.name, displayName: entry.displayName, version }]
                    : [];
            });
        const adapters = entries("adapter").map(adapter => {
            const extension = TRUSTED_EXTENSION_CATALOG.find(
                entry => entry.type === "adapter" && entry.name === adapter.name,
            );
            const capability = getExtensionCapabilityCatalogEntry(adapter.name);
            const packageEntry = extension
                ? getExtensionPackageCatalogEntry(extension.packageName)
                : undefined;
            if (!extension || !capability)
                throw new Error(`适配器目录缺少产品信息: ${adapter.name}`);
            const versionMatched =
                capability.packageVersion === adapter.version &&
                packageEntry?.packageVersion === adapter.version;
            return {
                ...adapter,
                description: extension.description,
                packageName: extension.packageName,
                setup: extension.setup.map(step => ({ ...step })),
                requirements: extension.requirements.map(requirement => ({ ...requirement })),
                ...(versionMatched
                    ? {
                          peerDependencies: Object.entries(packageEntry.peerDependencies ?? {}).map(
                              ([packageName, range]) => ({ packageName, range }),
                          ),
                          capabilitySnapshot: {
                              packageVersion: capability.packageVersion,
                              summary: summarizeManifest(capability.manifest),
                              manifest: structuredClone(capability.manifest),
                          },
                      }
                    : {}),
            };
        });
        return {
            activeGenerationId,
            selection: structuredClone(
                this.options.currentSelection?.() ?? {
                    adapters: [],
                    protocols: [],
                    applications: [],
                },
            ),
            adapters,
            protocols: entries("protocol"),
            applications: BUILTIN_APPLICATIONS.map(application => ({ ...application })),
        };
    }
}
