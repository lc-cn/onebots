import metadata from "../../package.json" with { type: "json" };
import { TRUSTED_EXTENSION_CATALOG as catalog } from "../trusted-extension-catalog.js";
import { listFrameworkProfiles } from "../framework-integration.js";
import type { RuntimePluginSelection } from "../runtime-plugin-selection.js";
import {
    createInstallationPlan,
    installPackages,
    loadSelection,
    TuiLocalRuntime,
    type InstallationDependencies,
} from "./installation.js";
import { TuiCancelled, type TuiPrompt } from "./prompt.js";

/** 安装向导保存选择与当前步骤，失败只重试失败阶段；认证信息只存在本次会话。 */
export async function runInstallation(
    prompt: TuiPrompt,
    root: string,
    initial: RuntimePluginSelection,
    dependencies: InstallationDependencies = {
        install: (packages, root, token, progress) =>
            installPackages(packages, root, token, undefined, progress),
        verify: loadSelection,
    },
): Promise<RuntimePluginSelection> {
    const selection = structuredClone(initial);
    let step = 0;
    let token = "";
    const names = ["平台", "安装凭据", "协议", "框架", "确认"];
    try {
        while (true) {
            prompt.progress?.(
                names
                    .map(
                        (name, index) =>
                            `${index < step ? "✓" : index === step ? "●" : "○"} ${name}`,
                    )
                    .join("  "),
            );
            try {
                if (step === 0) {
                    selection.adapters = await prompt.ask({
                        title: "选择平台",
                        multiple: true,
                        selected: selection.adapters,
                        choices: catalog
                            .filter(item => item.type === "adapter")
                            .map(item => ({
                                value: item.name,
                                label: `${item.displayName} · ${item.description}`,
                            })),
                    });
                    if (!selection.adapters.includes("icqq")) token = "";
                    step = 1;
                } else if (step === 1) {
                    if (selection.adapters.includes("icqq")) {
                        const [answer] = await prompt.ask({
                            title: "ICQQ 安装凭据",
                            secret: true,
                            detail: `GitHub Packages Token 需要 read:packages 和 @icqqjs 包读取权限。\nhttps://github.com/settings/tokens\n${token ? "已输入凭据，留空保留。" : "留空使用已有 npm 认证。"}本次安装结束后清除，不写入配置。`,
                        });
                        if (answer) token = answer;
                    }
                    step = 2;
                } else if (step === 2) {
                    selection.protocols = await prompt.ask({
                        title: "选择输出协议",
                        multiple: true,
                        selected: selection.protocols,
                        choices: catalog
                            .filter(item => item.type === "protocol")
                            .map(item => ({
                                value: item.name,
                                label: `${item.displayName} · ${item.description}`,
                            })),
                    });
                    step = 3;
                } else if (step === 3) {
                    selection.applications = await prompt.ask({
                        title: "选择下游框架",
                        multiple: true,
                        selected: selection.applications ?? [],
                        detail: "选择 OneBots 内置兼容方案。框架程序在下游单独部署；此处不自动启用任何账号出口。",
                        choices: listFrameworkProfiles().map(item => ({
                            value: item.id,
                            label: `${item.displayName} · ${item.protocol} · ${item.applicationStage === "experimental" ? "实验方案" : item.verification === "verified" ? "已验证" : "见方案验证范围"}`,
                        })),
                    });
                    step = 4;
                } else {
                    let plan: ReturnType<typeof createInstallationPlan>;
                    try {
                        plan = createInstallationPlan(selection);
                    } catch (error) {
                        prompt.report(error instanceof Error ? error.message : "选择不匹配");
                        step = 2;
                        continue;
                    }
                    const [action] = await prompt.ask({
                        title: "确认部署选择",
                        detail: [
                            `运行目录：${root}`,
                            `主程序：onebots@${metadata.version}`,
                            `安装依赖：\n${plan.packages.join("\n") || "无"}`,
                            `框架：${selection.applications?.join("、") || "无"}`,
                            `安装凭据：${token ? "已填写 · 隐藏" : "已有认证或不需要"}`,
                        ].join("\n"),
                        choices: [
                            { value: "install", label: "确认，安装并验证" },
                            { value: "0", label: "修改平台" },
                            { value: "1", label: "修改安装凭据" },
                            { value: "2", label: "修改协议" },
                            { value: "3", label: "修改框架" },
                            { value: "cancel", label: "返回工作区" },
                        ],
                    });
                    if (action === "cancel") throw new TuiCancelled();
                    if (action !== "install") {
                        step = Number(action);
                        continue;
                    }
                    let installed = false;
                    while (true) {
                        try {
                            if (!installed) {
                                prompt.progress?.("安装依赖");
                                await dependencies.install(plan.packages, root, token, message =>
                                    prompt.progress?.(message),
                                );
                                installed = true;
                            }
                            prompt.progress?.("验证插件加载与注册");
                            await dependencies.verify(selection, root);
                            prompt.report("依赖已验证。下一步配置账号和协议，然后统一保存并启动。");
                            return selection;
                        } catch (error) {
                            if (error instanceof TuiLocalRuntime) throw error;
                            prompt.report(error instanceof Error ? error.message : "安装未完成");
                            const [recovery] = await prompt.ask({
                                title: installed ? "插件验证失败" : "依赖安装失败",
                                choices: [
                                    { value: "retry", label: "重试当前阶段（保留选择）" },
                                    { value: "credentials", label: "修改凭据后重试安装" },
                                    { value: "edit", label: "返回确认页调整方案" },
                                    { value: "cancel", label: "返回工作区" },
                                ],
                            });
                            if (recovery === "cancel") throw new TuiCancelled();
                            if (recovery === "retry") continue;
                            step = recovery === "credentials" ? 1 : 4;
                            break;
                        }
                    }
                }
            } catch (error) {
                if (!(error instanceof TuiCancelled)) throw error;
                if (step === 0 || step === 4) throw error;
                step = step === 2 && !selection.adapters.includes("icqq") ? 0 : step - 1;
            }
        }
    } finally {
        token = "";
        prompt.progress?.("");
    }
}
