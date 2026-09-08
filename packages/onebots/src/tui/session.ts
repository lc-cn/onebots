import { isContainerRuntime } from "../container-runtime.js";
import { selectContainerExtensions, containerServiceAction } from "./container.js";
import * as path from "node:path";
import { resolveGatewayBaseUrl } from "../doctor.js";
import { getAppConfigSchema } from "../config-schema.js";
import { createFrameworkConnectionPlan } from "../framework-integration.js";
import { ServiceController } from "../service-manager.js";
import {
    installService,
    startService,
    stopService,
    restartService,
    serviceStatus,
    serviceLogs,
    diagnose,
} from "../cli/command-application.js";
import { withCliOutput } from "../cli-output.js";
import { getWebUrl, openWeb } from "../ui.js";
import { loadSelection, TuiLocalRuntime } from "./installation.js";
import { runInstallation } from "./onboarding.js";
import { configureAccounts } from "./configuration.js";
import { editSchema } from "./form.js";
import {
    TerminalWorkspace,
    TERMINAL_PAGES,
    nextWorkspaceStep,
    type TerminalPage,
} from "./workspace.js";
import { confirm, TuiCancelled, type PromptChoice, type TuiPrompt } from "./prompt.js";

export interface SessionPrompt extends TuiPrompt {
    section(page: TerminalPage): void;
    refresh(): void;
}
export interface SessionOptions {
    setup?: boolean;
    configure?: boolean;
    system?: boolean;
}

export function pageChoices(page: TerminalPage, workspace: TerminalWorkspace): PromptChoice[] {
    const summary = workspace.summary();
    const next = nextWorkspaceStep(summary);
    const actions: Record<TerminalPage, PromptChoice[]> = {
        overview: [
            { value: `$page:${next.page}`, label: `继续：${next.label}` },
            { value: "deploy", label: "保存并启动 / 应用配置" },
        ],
        extensions: [{ value: "extensions", label: "选择、安装或修复扩展" }],
        accounts: [{ value: "accounts", label: "添加、编辑或删除平台账号" }],
        protocols: [{ value: "protocols", label: "配置各账号的协议出口" }],
        frameworks: [
            { value: "connections", label: "生成下游连接配置与检查步骤" },
            { value: "extensions", label: "调整框架方案" },
        ],
        service: [
            { value: "deploy", label: "保存并启动 / 应用配置" },
            { value: "stop", label: "停止服务" },
            { value: "status", label: "详细状态" },
            { value: "logs", label: "查看日志" },
            { value: "doctor", label: "诊断与排查" },
            { value: "web", label: "打开 Web 管理端" },
        ],
        settings: [
            { value: "settings", label: "编辑网关设置" },
            { value: "save", label: "检查并保存草稿" },
            { value: "reload", label: "放弃草稿并重新载入" },
            { value: "restore", label: "从备份恢复到草稿" },
        ],
    };
    if (isContainerRuntime()) {
        const labels: Record<string, string> = {
            deploy: "保存配置，查看容器重启步骤",
            stop: "查看容器停止命令",
            status: "查看 Docker 状态命令",
            logs: "查看容器日志命令",
            doctor: "查看容器健康检查命令",
            extensions: "选择已安装的扩展",
        };
        for (const choices of Object.values(actions))
            for (const choice of choices)
                if (labels[choice.value]) choice.label = labels[choice.value];
    }
    return [
        ...actions[page],
        ...(summary.dirty && page !== "settings"
            ? [{ value: "save", label: "检查并保存草稿" }]
            : []),
        ...TERMINAL_PAGES.filter(
            item =>
                item.id !== page &&
                !actions[page].some(action => action.value === `$page:${item.id}`),
        ).map(item => ({
            value: `$page:${item.id}`,
            label: `转到 ${item.label}`,
        })),
        { value: "quit", label: "退出工作台" },
    ];
}

export function pageDescription(page: TerminalPage, workspace: TerminalWorkspace): string {
    const state = workspace.summary();
    if (state.error) return state.error;
    if (state.conflict) return "配置已在工作区外更新；当前草稿保留中，请到设置处理冲突。";
    if (page === "extensions")
        return `平台：${state.adapters.join("、") || "未选择"}\n协议：${state.protocols.join("、") || "未选择"}\n框架：${state.frameworks.join("、") || "未选择"}`;
    if (page === "accounts")
        return state.accounts.length
            ? state.accounts.join("\n")
            : "尚无机器人账号。先在扩展页选择平台，再添加账号。";
    if (page === "protocols")
        return "安装协议与启用账号出口分别管理。选择账号后配置连接方式与鉴权。";
    if (page === "frameworks")
        return `已选方案：${state.frameworks.join("、") || "无"}\n连接模板会同时提供 OneBots 端、框架端配置与检查步骤。`;
    if (page === "settings")
        return `配置文件：${workspace.configPath}\n运行目录：${workspace.root}\n${state.dirty ? `草稿修改：${state.changes.join("、")}` : "配置与磁盘一致"}`;
    if (page === "service" && isContainerRuntime())
        return "配置可在此保存；启动、停止、日志和在线状态由宿主 Docker/Compose 管理。";
    if (page === "service")
        return state.needsRestart
            ? "配置已保存，尚未应用到运行服务。选择“保存并启动 / 应用配置”。"
            : "统一完成配置校验、服务安装、启动与在线验证；失败后可在此诊断或重试。";
    return `${state.configured ? "部署工作区" : "欢迎使用 OneBots"}\n${!state.adapters.length ? "① 选择平台、协议和框架" : "✓ 扩展选择"}\n${!state.accounts.length ? "② 添加账号并配置协议出口" : `✓ ${state.accounts.length} 个账号`}\n③ 保存并启动，验证在线状态`;
}

/** 导航和执行共用一个工作区，失败保留配置草稿，旧命令仅作为入口。 */
export async function runTuiSession(
    prompt: SessionPrompt,
    workspace: TerminalWorkspace,
    options: SessionOptions = {},
): Promise<void> {
    let page: TerminalPage = options.setup
        ? "extensions"
        : options.configure
          ? "accounts"
          : "overview";
    const system = options.system ?? false;
    while (true) {
        workspace.sync();
        prompt.section(page);
        prompt.refresh();
        let action: string;
        try {
            [action] = await prompt.ask({
                title: TERMINAL_PAGES.find(item => item.id === page).label,
                detail: pageDescription(page, workspace),
                choices: pageChoices(page, workspace),
                navigation: true,
            });
        } catch (error) {
            if (!(error instanceof TuiCancelled)) throw error;
            action = "quit";
        }
        if (action === "$next") {
            page =
                TERMINAL_PAGES[
                    (TERMINAL_PAGES.findIndex(item => item.id === page) + 1) % TERMINAL_PAGES.length
                ].id;
            continue;
        }
        if (action.startsWith("$page:")) {
            const target = TERMINAL_PAGES.find(item => item.id === action.slice(6));
            if (target) page = target.id;
            continue;
        }
        if (action === "quit") {
            if (
                !workspace.dirty ||
                (await confirm(
                    prompt,
                    "放弃未保存草稿并退出？",
                    "选择返回可继续编辑，也可先在设置中保存。",
                ).catch(error => {
                    if (!(error instanceof TuiCancelled)) throw error;
                    return false;
                }))
            )
                return;
            continue;
        }
        try {
            await withCliOutput(
                message => prompt.report(message),
                async () => {
                    if (action === "extensions") {
                        const selection = isContainerRuntime()
                            ? await selectContainerExtensions(
                                  prompt,
                                  workspace.root,
                                  workspace.selection,
                              )
                            : await runInstallation(prompt, workspace.root, workspace.selection);
                        workspace.select(selection);
                        page = "accounts";
                    } else if (action === "accounts" || action === "protocols") {
                        await loadSelection(workspace.selection, workspace.root);
                        const draft = workspace.config;
                        try {
                            await configureAccounts(
                                prompt,
                                draft,
                                workspace.selection,
                                action === "protocols",
                            );
                        } finally {
                            workspace.update(draft);
                        }
                    } else if (action === "settings") {
                        const schema = { ...getAppConfigSchema().base };
                        delete schema.plugins;
                        workspace.update(
                            await editSchema(prompt, schema, workspace.config, "网关设置"),
                        );
                    } else if (action === "save") await saveWorkspace(prompt, workspace);
                    else if (action === "deploy") await deployWorkspace(prompt, workspace, system);
                    else if (action === "reload") {
                        if (
                            !workspace.dirty ||
                            (await confirm(prompt, "放弃当前草稿并载入磁盘配置？"))
                        )
                            workspace.reload();
                    } else if (action === "restore") {
                        if (
                            await confirm(
                                prompt,
                                "将 .bak 恢复到草稿？",
                                "恢复后先检查，再确认保存。",
                            )
                        )
                            workspace.restoreBackup();
                    } else if (action === "connections") await showConnections(prompt, workspace);
                    else if (action === "web") await openWeb(getWebUrl(workspace.configPath));
                    else await runServiceAction(prompt, workspace, action, system);
                },
            );
        } catch (error) {
            if (error instanceof TuiCancelled) continue;
            if (error instanceof TuiLocalRuntime && prompt.handoff) {
                workspace.select(error.selection);
                await prompt.handoff(
                    error.binPath,
                    [
                        "ui",
                        "--configure",
                        "-c",
                        workspace.configPath,
                        ...(system ? ["--system"] : []),
                        ...error.selection.adapters.flatMap(name => ["-r", name]),
                        ...error.selection.protocols.flatMap(name => ["-p", name]),
                        ...(error.selection.applications ?? []).flatMap(name => ["-t", name]),
                    ],
                    workspace.root,
                );
                return;
            }
            prompt.report(error instanceof Error ? error.message : "操作失败，草稿已保留");
            try {
                await prompt
                    .ask({
                        title: "操作未完成 · 草稿已保留",
                        choices: [
                            { value: "back", label: "返回当前页面，修改或重试" },
                            { value: "diagnose", label: "前往运行页诊断" },
                        ],
                    })
                    .then(([answer]) => {
                        if (answer === "diagnose") page = "service";
                    });
            } catch (cancel) {
                if (!(cancel instanceof TuiCancelled)) throw cancel;
            }
        } finally {
            prompt.progress?.("");
            prompt.refresh();
        }
    }
}

async function saveWorkspace(
    prompt: SessionPrompt,
    workspace: TerminalWorkspace,
): Promise<boolean> {
    if (
        !(await confirm(
            prompt,
            "检查并保存配置？",
            `修改项：${workspace.summary().changes.join("、") || "初始化配置"}\n凭据不显示；已有配置会备份。`,
        ))
    )
        return false;
    prompt.progress?.("检查依赖与完整配置");
    await loadSelection(workspace.selection, workspace.root);
    workspace.commit();
    prompt.report("配置已保存，待应用到服务。可在运行页选择“保存并启动 / 应用配置”。");
    return true;
}

interface DeploymentDependencies {
    status(): { installed: boolean; running: boolean };
    install(): Promise<unknown>;
    start(): Promise<unknown>;
    restart(): Promise<unknown>;
}

/** 统一服务上线流程，每一步成功后才进入下一步；复用 CLI 的线上验证。 */
export async function executeDeployment(dependencies: DeploymentDependencies): Promise<void> {
    const initial = dependencies.status();
    if (!initial.installed) await dependencies.install();
    if (initial.running) await dependencies.restart();
    else await dependencies.start();
}

function assertServiceTarget(workspace: TerminalWorkspace, system: boolean): void {
    const spec = new ServiceController(system ? "system" : "user").readSpec();
    if (spec && path.resolve(spec.configPath) !== path.resolve(workspace.configPath))
        throw new Error(`此服务使用其他配置：${spec.configPath}。请切换到对应工作区后管理。`);
}

async function deployWorkspace(
    prompt: SessionPrompt,
    workspace: TerminalWorkspace,
    system: boolean,
) {
    if (isContainerRuntime()) return containerServiceAction(prompt, workspace, "deploy");
    assertServiceTarget(workspace, system);
    if (
        !(await confirm(
            prompt,
            "保存并应用到服务？",
            "将校验配置、保存草稿、按需安装服务，再启动或重启并验证在线状态。",
        ))
    )
        return;
    prompt.progress?.("校验配置与依赖");
    await loadSelection(workspace.selection, workspace.root);
    if (workspace.dirty || !workspace.summary().configured) workspace.commit();
    const runtime = {
        config: workspace.configPath,
        register: [],
        protocol: [],
        target: [],
        system,
    };
    const controller = new ServiceController(system ? "system" : "user");
    await executeDeployment({
        status: () => controller.status(),
        install: async () => {
            prompt.progress?.("安装服务");
            return installService(runtime);
        },
        start: async () => {
            prompt.progress?.("启动服务并验证在线状态");
            return startService(runtime);
        },
        restart: async () => {
            prompt.progress?.("重启服务并验证新实例");
            return restartService(runtime);
        },
    });
    workspace.needsRestart = false;
    prompt.report("服务已通过在线验证。可以查看框架连接说明，或打开 Web 管理端。");
}

async function runServiceAction(
    prompt: SessionPrompt,
    workspace: TerminalWorkspace,
    action: string,
    system: boolean,
) {
    if (isContainerRuntime()) return containerServiceAction(prompt, workspace, action);
    if (action !== "doctor") assertServiceTarget(workspace, system);
    if (action === "stop" && !(await confirm(prompt, "停止当前服务？"))) return;
    prompt.progress?.(action === "doctor" ? "检查运行环境与配置" : "读取服务状态");
    const result =
        action === "stop"
            ? await stopService({ system })
            : action === "status"
              ? await serviceStatus({ system })
              : action === "logs"
                ? await serviceLogs({ system, follow: false, lines: 80 })
                : await diagnose({
                      config: workspace.configPath,
                      register: [],
                      protocol: [],
                      target: [],
                      system,
                      fix: false,
                      json: false,
                  });
    prompt.progress?.("");
    await prompt.ask({
        title: action === "logs" ? "服务日志" : action === "doctor" ? "诊断结果" : "服务状态",
        detail: result.output || "操作完成",
        choices: [{ value: "back", label: "返回运行页" }],
    });
}

async function showConnections(prompt: SessionPrompt, workspace: TerminalWorkspace) {
    const state = workspace.summary();
    if (!state.frameworks.length || !state.accounts.length) {
        prompt.report("先选择框架并添加平台账号，然后生成连接说明。");
        return;
    }
    const [framework] = await prompt.ask({
        title: "选择框架",
        choices: state.frameworks.map(value => ({ value, label: value })),
    });
    const [account] = await prompt.ask({
        title: "选择账号",
        choices: state.accounts.map(value => ({ value, label: value })),
    });
    const [origin] = await prompt.ask({
        title: "框架可访问的 OneBots 地址",
        initial: resolveGatewayBaseUrl(workspace.config),
    });
    const [frameworkOrigin] = await prompt.ask({
        title: "框架监听地址",
        detail: "反向连接时使用，留空使用方案默认值。",
    });
    const plan = createFrameworkConnectionPlan({
        framework,
        account,
        onebotsOrigin: origin,
        frameworkOrigin: frameworkOrigin || undefined,
    });
    await prompt.ask({
        title: `${framework} / ${account}`,
        detail: [
            "OneBots 端配置：",
            plan.onebotsConfig,
            "框架端配置：",
            plan.frameworkConfig,
            ...plan.checks.map(
                check =>
                    `${check.name}：${check.expected}${check.command ? `\n${check.command}` : ""}`,
            ),
            ...plan.limitations,
            `https://onebots.pages.dev/solutions/${framework}`,
            "模板中的鉴权占位符需要替换；配置变更通过协议页保存并应用。",
        ].join("\n"),
        choices: [{ value: "back", label: "返回框架页" }],
    });
}
