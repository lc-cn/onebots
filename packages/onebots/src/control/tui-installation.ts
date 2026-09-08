import { randomUUID } from "node:crypto";
import type { ControlClient, ControlInstallOperation } from "@onebots/core/control";
import type { TuiPrompt } from "../tui/prompt.js";

export interface ControlInstallationTuiOptions {
    requestId?: () => string;
    wait?: () => Promise<void>;
}
export async function confirmControlAction(
    prompt: TuiPrompt,
    title: string,
    detail?: string,
): Promise<boolean> {
    return (
        (
            await prompt.ask({
                title,
                detail,
                choices: [
                    { value: "no", label: "返回，不执行" },
                    { value: "yes", label: "确认执行" },
                ],
            })
        )[0] === "yes"
    );
}
export async function runControlInstallation(
    client: ControlClient,
    prompt: TuiPrompt,
    options: ControlInstallationTuiOptions = {},
): Promise<void> {
    const catalog = await client.installationCatalog();
    const selection = {
        adapters: [] as string[],
        protocols: [] as string[],
        applications: [] as string[],
    };
    for (const [key, title] of [
        ["adapters", "选择平台适配器"],
        ["protocols", "选择输出协议"],
        ["applications", "选择框架解决方案"],
    ] as const) {
        selection[key] = await prompt.ask({
            title,
            multiple: true,
            selected: catalog.selection[key],
            detail:
                key === "applications"
                    ? "框架兼容能力独立选择，不会自动启用任何协议或账号。"
                    : undefined,
            choices: catalog[key].map(item => ({ value: item.name, label: item.displayName })),
        });
        if (selection[key].some(name => !catalog[key].some(item => item.name === name)))
            throw new Error("扩展选择无效");
    }
    const plan = await client.planInstallation(selection, catalog.activeGenerationId);
    const detail = [
        ...plan.packages.map(item => `${item.name}@${item.version}`),
        ...plan.peers.map(
            item => `必需依赖：${item.packageName}@${item.range}（${item.requestedBy}）`,
        ),
        ...plan.recommendations.map(item => `建议：${item}`),
        "依赖下载后仍须验证；激活另行确认，不自动启用平台账号或协议。",
    ].join("\n");
    if (!(await confirmControlAction(prompt, "确认安装计划", detail))) return;
    let token: string | undefined;
    if (
        plan.packages.some(item => item.name === "@onebots/adapter-icqq") ||
        plan.peers.some(item => item.packageName.startsWith("@icqqjs/"))
    ) {
        token =
            (
                await prompt.ask({
                    title: "GitHub Packages read:packages 凭据（仅本次安装）",
                    secret: true,
                })
            )[0] || undefined;
    }
    const id = options.requestId?.() ?? randomUUID();
    prompt.report(`安装任务：${id}。结果不明时请查询此任务，不要重复创建。`);
    try {
        await client.install({ id, planId: plan.id, ...(token ? { token } : {}) });
    } catch {
        prompt.report("提交结果暂不可确认，正在查询原任务。");
    } finally {
        token = undefined;
    }
    await trackControlInstallation(client, prompt, id, options);
}
export async function trackControlInstallation(
    client: ControlClient,
    prompt: TuiPrompt,
    id: string,
    options: ControlInstallationTuiOptions = {},
): Promise<void> {
    let cancelRequested = false;
    while (true) {
        let operation: ControlInstallOperation;
        try {
            operation = await client.installation(id);
        } catch {
            prompt.report(`任务 ${id} 状态暂不可确认。请稍后查询原任务；不会自动重试安装。`);
            return;
        }
        prompt.report(`任务 ${id}：${operation.phase}`);
        if (operation.phase === "verified") {
            if (!operation.candidateId) {
                prompt.report("验证任务缺少运行版本，未激活。");
                return;
            }
            if (
                await confirmControlAction(
                    prompt,
                    "激活已验证运行版本？",
                    "管理服务会切换依赖版本，保留当前网关启停意图；账号和协议仍需单独配置。",
                )
            ) {
                try {
                    const result = await client.activateGeneration(operation.candidateId);
                    prompt.report(
                        result.status === "succeeded"
                            ? "运行版本已激活。"
                            : "激活尚未成功，请查看管理状态。",
                    );
                } catch {
                    prompt.report("激活结果暂不可确认，请查看管理状态；未自动重试。");
                }
            }
            return;
        }
        if (["failed", "interrupted"].includes(operation.phase)) {
            prompt.report("安装未完成，未激活。请在管理端检查任务。 ");
            return;
        }
        const [action] = await prompt.ask({
            title: "安装处理中",
            choices: [
                { value: "wait", label: "等待并刷新" },
                ...(!cancelRequested ? [{ value: "cancel", label: "取消此安装任务" }] : []),
                { value: "back", label: "返回菜单，后台继续" },
            ],
        });
        if (action === "back") return;
        if (action === "cancel" && !cancelRequested) {
            cancelRequested = true;
            try {
                await client.cancelInstallation(id);
            } catch {
                prompt.report("取消结果暂不可确认，继续查询原任务。");
            }
        }
        await (options.wait?.() ?? new Promise(resolve => setTimeout(resolve, 1000)));
    }
}
