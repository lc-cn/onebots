import * as fs from "node:fs";
import * as path from "node:path";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useStdin } from "ink";
import { spawn } from "node:child_process";
import {
    getRuntimePluginSelection,
    type RuntimePluginSelection,
} from "../runtime-plugin-selection.js";
import {
    installService,
    startService,
    stopService,
    restartService,
    serviceStatus,
    serviceLogs,
    diagnose,
} from "../cli/command-application.js";
import { createFrameworkConnectionPlan } from "../framework-integration.js";
import { getWebUrl, openWeb } from "../ui.js";
import { configureRuntime, readConfiguration } from "./configuration.js";
import { loadSelection, runInstallation, TuiLocalRuntime } from "./installation.js";
import { confirm, PromptView, TuiCancelled, type PromptRequest, type TuiPrompt } from "./prompt.js";

export interface TuiOptions {
    configPath: string;
    system?: boolean;
    setup?: boolean;
    configure?: boolean;
    selection?: RuntimePluginSelection;
}

interface PendingPrompt {
    id: number;
    request: PromptRequest;
    resolve(answer: string[]): void;
    reject(error: Error): void;
}

/** 单个 Ink renderer 同时承载首次引导与日常管理。 */
export function OneBotsTui(options: TuiOptions) {
    const { exit } = useApp();
    const { setRawMode } = useStdin();
    const [handoff, setHandoff] = useState<{
        bin: string;
        args: string[];
        root: string;
        resolve(): void;
        reject(error: Error): void;
    }>();
    const [pending, setPending] = useState<PendingPrompt>();
    const [message, setMessage] = useState("");
    const started = useRef(false);
    const active = useRef<PendingPrompt | undefined>(undefined);
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        let id = 0;
        const prompt: TuiPrompt = {
            ask: request =>
                new Promise((resolve, reject) => {
                    const next = { id: ++id, request, resolve, reject };
                    active.current = next;
                    setPending(next);
                }),
            report: setMessage,
            handoff: (bin, args, root) =>
                new Promise((resolve, reject) => setHandoff({ bin, args, root, resolve, reject })),
        };
        void runTuiSession(prompt, options)
            .then(() => exit())
            .catch(error => {
                if (!(error instanceof TuiCancelled)) {
                    process.exitCode = 1;
                    setMessage(error instanceof Error ? error.message : "操作失败");
                }
                exit();
            });
        return () => active.current?.reject(new TuiCancelled());
    }, []);
    useEffect(() => {
        if (!handoff) return;
        setRawMode(false);
        const child = spawn(process.execPath, [handoff.bin, ...handoff.args], {
            stdio: "inherit",
            cwd: handoff.root,
        });
        child.once("error", handoff.reject);
        child.once("exit", code => {
            if (code === 0) handoff.resolve();
            else handoff.reject(new Error("本地 OneBots 引导未完成，请运行 onebots tui 重试"));
        });
    }, [handoff]);
    const finish = (value?: string[]) => {
        const request = active.current;
        active.current = undefined;
        setPending(undefined);
        if (value) request?.resolve(value);
        else request?.reject(new TuiCancelled());
    };
    if (handoff) return null;
    return (
        <Box flexDirection="column" paddingX={1}>
            <Text bold color="cyan">
                OneBots · 安装、配置与管理
            </Text>
            <Text dimColor>配置：{options.configPath}</Text>
            {message && <Text>{message}</Text>}
            {pending ? (
                <PromptView
                    key={pending.id}
                    request={pending.request}
                    complete={finish}
                    cancel={() => finish()}
                />
            ) : (
                <Text dimColor>正在处理，请等待…</Text>
            )}
        </Box>
    );
}

export async function runTuiSession(prompt: TuiPrompt, options: TuiOptions): Promise<void> {
    const root = path.resolve(process.env.ONEBOTS_EXTENSION_ROOT ?? process.cwd());
    const system = options.system ?? false;
    let selection = options.selection ??
        getRuntimePluginSelection(readConfiguration(options.configPath)) ?? {
            adapters: [],
            protocols: [],
            applications: [],
        };
    let first = options.configure
        ? "config"
        : options.setup || !fs.existsSync(options.configPath)
          ? "setup"
          : "";
    while (true) {
        let choosingAction = false;
        try {
            if (!first)
                selection =
                    getRuntimePluginSelection(readConfiguration(options.configPath)) ?? selection;
            choosingAction = !first;
            const [action] = first
                ? [first]
                : await prompt.ask({
                      title: "OneBots 管理菜单",
                      choices: [
                          { value: "config", label: "配置账号与协议" },
                          { value: "setup", label: "安装/调整适配器、协议和框架" },
                          { value: "connections", label: "查看下游框架连接配置" },
                          { value: "install", label: "安装守护服务" },
                          { value: "start", label: "启动服务" },
                          { value: "stop", label: "停止服务" },
                          { value: "restart", label: "重启服务，应用配置" },
                          { value: "status", label: "查看服务状态" },
                          { value: "logs", label: "查看最近日志" },
                          { value: "doctor", label: "诊断配置与依赖" },
                          { value: "web", label: "打开 Web 管理端" },
                          { value: "quit", label: "退出" },
                      ],
                  });
            first = "";
            choosingAction = false;
            if (action === "quit") return;
            if (action === "setup") {
                const installed = await runInstallation(prompt, root, selection);
                if (installed) {
                    // 草稿只在保存成功后成为后续服务操作的默认选择。
                    if (await configureRuntime(prompt, options.configPath, installed))
                        selection = installed;
                }
                continue;
            }
            if (action === "config") {
                await loadSelection(selection, root);
                await configureRuntime(prompt, options.configPath, selection);
                continue;
            }
            if (action === "connections") {
                await showConnections(prompt, options.configPath, selection);
                continue;
            }
            if (action === "web") {
                await openWeb(getWebUrl(options.configPath));
                continue;
            }
            const runtime = {
                config: options.configPath,
                register: [],
                protocol: [],
                target: [],
                system,
            };
            if (
                ["install", "stop", "restart", "start"].includes(action) &&
                !(await confirm(
                    prompt,
                    `确认${{ install: "安装守护服务", start: "启动服务", stop: "停止服务", restart: "重启服务" }[action]}？`,
                ))
            )
                continue;
            const result =
                action === "install"
                    ? await installService(runtime)
                    : action === "start"
                      ? await startService(runtime)
                      : action === "stop"
                        ? await stopService({ system })
                        : action === "restart"
                          ? await restartService(runtime)
                          : action === "status"
                            ? await serviceStatus({ system })
                            : action === "logs"
                              ? await serviceLogs({ system, follow: false, lines: 20 })
                              : await diagnose({ ...runtime, json: false, fix: false });
            prompt.report(result.output ?? "操作完成");
        } catch (error) {
            if (choosingAction && error instanceof TuiCancelled) return;
            if (error instanceof TuiLocalRuntime && prompt.handoff) {
                await prompt.handoff(
                    error.binPath,
                    [
                        "tui",
                        "--configure",
                        "-c",
                        options.configPath,
                        ...(system ? ["--system"] : []),
                        ...error.selection.adapters.flatMap(name => ["-r", name]),
                        ...error.selection.protocols.flatMap(name => ["-p", name]),
                        ...(error.selection.applications ?? []).flatMap(name => ["-t", name]),
                    ],
                    root,
                );
                return;
            }
            prompt.report(
                error instanceof Error ? error.message : "操作失败，请运行 onebots doctor 检查",
            );
        }
    }
}

async function showConnections(
    prompt: TuiPrompt,
    configPath: string,
    selection: RuntimePluginSelection,
) {
    if (!selection.applications?.length) {
        prompt.report("尚未选择框架，请从安装菜单添加框架方案。");
        return;
    }
    const config = readConfiguration(configPath);
    const accounts = Object.keys(config).filter(key =>
        selection.adapters.some(name => key.startsWith(`${name}.`)),
    );
    if (!accounts.length) {
        prompt.report("请先配置至少一个平台账号。");
        return;
    }
    const [framework] = await prompt.ask({
        title: "选择框架",
        choices: selection.applications.map(value => ({ value, label: value })),
    });
    const [account] = await prompt.ask({
        title: "选择账号",
        choices: accounts.map(value => ({ value, label: value })),
    });
    const [origin] = await prompt.ask({
        title: "框架可访问的 OneBots HTTP 地址",
        initial: getWebUrl(configPath),
        detail: "跨机器连接请使用实际域名或 IP；如有服务路径前缀，请一并填写。",
    });
    const [frameworkOrigin] = await prompt.ask({
        title: "框架监听地址（反向连接时使用）",
        detail: "留空使用该框架方案的默认地址。",
    });
    const plan = createFrameworkConnectionPlan({
        framework,
        account,
        onebotsOrigin: origin,
        frameworkOrigin: frameworkOrigin || undefined,
    });
    await prompt.ask({
        title: `${framework} 连接说明`,
        detail: [
            "OneBots 账号协议配置模板：",
            plan.onebotsConfig,
            "框架端配置模板：",
            plan.frameworkConfig,
            "请在配置菜单核对协议连接方式与鉴权，模板中的占位凭据需替换。",
            ...plan.limitations,
            `详细步骤：https://onebots.pages.dev/solutions/${framework}`,
        ].join("\n"),
        choices: [{ value: "back", label: "返回管理菜单" }],
    });
}
