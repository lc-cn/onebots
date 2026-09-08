import path from "node:path";
import type { ControlHostOptions } from "./host.js";
import type { GenerationActivationController } from "./generation-activation.js";
import type { GenerationStore } from "../installation/generation-store.js";
import { readGenerationPlan } from "../installation/generation-runtime.js";
import { recoverDownloadCredentials } from "../installation/generation-download.js";
import { ConfigurationFile } from "../configuration/configuration-file.js";
import { ControlInstallationService } from "./installation-service.js";
import { controlDirectory, prepareGatewayWorkspace } from "./workspace.js";

/** 恢复安装边界后再开放安装/升级服务，所有基线均由当前管理宿主提供。 */
export async function createHostInstallation(
    options: ControlHostOptions,
    workspace: string,
    generations: GenerationStore | undefined,
    lifecycle: GenerationActivationController,
    ownershipAvailable: boolean,
): Promise<ControlInstallationService | undefined> {
    try {
        if (!ownershipAvailable) throw new Error("历史管理进程所有权不可确认");
        const recovered = await recoverDownloadCredentials(
            path.join(controlDirectory(workspace), "downloads"),
        );
        if (recovered.blocked.length) throw new Error("下载进程或凭据归属尚待核实");
        if (!generations) return undefined;
        const source = new ConfigurationFile(path.join(workspace, "config.yaml"));
        return new ControlInstallationService({
            ...options.installation,
            directory: controlDirectory(workspace),
            store: generations,
            lifecycle,
            currentGenerationId: () => lifecycle.status().active?.id ?? null,
            currentConfigurationRevision: () => source.read().revision,
            currentSelection: () => {
                const active = lifecycle.activeGeneration();
                return active
                    ? readGenerationPlan(active).selection
                    : prepareGatewayWorkspace(workspace, options.runtimeRoot).selection;
            },
        });
    } catch {
        process.stderr.write("[onebots] 安装服务恢复未完成，保持管理端用于诊断\n");
        return undefined;
    }
}
