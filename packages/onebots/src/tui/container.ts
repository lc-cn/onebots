import { createRequire } from "node:module";
import * as path from "node:path";
import { TRUSTED_EXTENSION_CATALOG } from "../trusted-extension-catalog.js";
import { inspectPlugin, pluginCandidates } from "../plugin-loader.js";
import { listFrameworkProfiles } from "../framework-integration.js";
import type { RuntimePluginSelection } from "../runtime-plugin-selection.js";
import { createInstallationPlan, loadSelection } from "./installation.js";
import { confirm, type TuiPrompt } from "./prompt.js";
import type { TerminalWorkspace } from "./workspace.js";

/** 容器内只选择已安装扩展，不接收 registry 凭据或执行安装脚本。 */
export async function selectContainerExtensions(
    prompt: TuiPrompt,
    root: string,
    current: RuntimePluginSelection,
): Promise<RuntimePluginSelection> {
    const require = createRequire(path.join(root, "package.json"));
    const selection = structuredClone(current);
    for (const type of ["adapter", "protocol"] as const) {
        const field = type === "adapter" ? "adapters" : "protocols";
        const installed = TRUSTED_EXTENSION_CATALOG.filter(
            item =>
                item.type === type &&
                inspectPlugin(pluginCandidates(type, item.name), require).status === "ready",
        );
        selection[field] = await prompt.ask({
            title: type === "adapter" ? "选择已安装的平台" : "选择已安装的协议",
            multiple: true,
            selected: current[field],
            detail: "缺少扩展时，在宿主运行 scripts/docker-extensions.sh install icqq，再重启容器。此处不下载，也不接收安装 Token。",
            choices: installed.map(item => ({ value: item.name, label: item.displayName })),
        });
    }
    selection.applications = await prompt.ask({
        title: "选择框架方案",
        multiple: true,
        selected: current.applications ?? [],
        choices: listFrameworkProfiles().map(item => ({
            value: item.id,
            label: `${item.displayName} · ${item.protocol}`,
        })),
    });
    createInstallationPlan(selection);
    await loadSelection(selection, root);
    return selection;
}
export async function containerServiceAction(
    prompt: TuiPrompt,
    workspace: TerminalWorkspace,
    action: string,
): Promise<void> {
    if (action === "deploy") {
        if (
            !(await confirm(
                prompt,
                "检查并保存配置？",
                "容器重启由宿主 Docker/Compose 执行；这里不会安装守护服务或宣告网关已经上线。",
            ))
        )
            return;
        await loadSelection(workspace.selection, workspace.root);
        if (workspace.dirty || !workspace.summary().configured) workspace.commit();
        prompt.report("配置已保存，待宿主重启容器并验证。");
    }
    const command =
        action === "logs"
            ? "docker compose logs --tail 100 onebots"
            : action === "stop"
              ? "docker compose stop onebots"
              : action === "deploy"
                ? "docker compose restart onebots"
                : action === "doctor"
                  ? "docker compose exec onebots node /app/scripts/docker-healthcheck.mjs"
                  : "docker compose ps onebots";
    await prompt.ask({
        title: "Docker 运行管理",
        detail: `请在宿主机执行：\n${command}\n重启后执行 docker compose ps onebots，并检查 healthy 状态。\n扩展安装与回滚：https://onebots.pages.dev/guide/docker-private-extensions`,
        choices: [{ value: "back", label: "返回工作台" }],
    });
}
