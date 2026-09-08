import { isContainerRuntime } from "../container-runtime.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useStdin, useStdout } from "ink";
import type { RuntimePluginSelection } from "../runtime-plugin-selection.js";
import { ServiceController } from "../service-manager.js";
import { resolveServiceWorkingDirectory } from "../cli/command-application.js";
import { TerminalWorkspace, TERMINAL_PAGES, type TerminalPage } from "./workspace.js";
import { readInstallationRequest } from "../installation-request.js";
import { loadSelection } from "../installation-local.js";
import { localRuntimeBin } from "../installation-local.js";
import { runTuiSession, type SessionPrompt } from "./session.js";
import { PromptView, TuiCancelled, type PromptRequest } from "./prompt.js";

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
interface Handoff {
    bin: string;
    args: string[];
    root: string;
    resolve(): void;
    reject(error: Error): void;
}

/** 唯一终端外壳：持久导航、部署状态、共享草稿和异步操作均留在同一工作区。 */
export function OneBotsTui(options: TuiOptions) {
    const { exit } = useApp();
    const { setRawMode } = useStdin();
    const { stdout } = useStdout();
    const [workspace] = useState(
        () => new TerminalWorkspace(options.configPath, resolveServiceWorkingDirectory()),
    );
    const [page, setPage] = useState<TerminalPage>("overview");
    const [pending, setPending] = useState<PendingPrompt>();
    const [message, setMessage] = useState("");
    const [progress, setProgress] = useState("");
    const [status, setStatus] = useState("读取中");
    const [handoff, setHandoff] = useState<Handoff>();
    const [, redraw] = useState(0);
    const active = useRef<PendingPrompt | undefined>(undefined);
    const started = useRef(false);
    useEffect(() => {
        if (isContainerRuntime()) {
            setStatus("由 Docker 管理");
            return;
        }
        const controller = new ServiceController(options.system ? "system" : "user");
        const refresh = () => {
            try {
                const spec = controller.readSpec();
                const state = controller.status();
                setStatus(
                    spec && path.resolve(spec.configPath) !== workspace.configPath
                        ? "其他工作区"
                        : state.running
                          ? "运行中"
                          : state.installed
                            ? "已停止"
                            : "尚未安装",
                );
            } catch {
                setStatus("状态不可用 · 请到运行页诊断");
            }
        };
        refresh();
        const timer = setInterval(refresh, 3000);
        return () => clearInterval(timer);
    }, [workspace, options.system]);
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        let id = 0;
        const prompt: SessionPrompt = {
            ask: request =>
                new Promise((resolve, reject) => {
                    const next = { id: ++id, request, resolve, reject };
                    active.current = next;
                    setPending(next);
                }),
            report: setMessage,
            progress: setProgress,
            section: setPage,
            refresh: () => redraw(value => value + 1),
            handoff: (bin, args, root) =>
                new Promise((resolve, reject) => setHandoff({ bin, args, root, resolve, reject })),
        };
        void (async () => {
            // 私有临时文件只用于全局/npx 宿主交接，避免凭据出现在 argv 或终端输出。
            const resumePath = process.env.ONEBOTS_TUI_RESUME;
            if (resumePath) {
                delete process.env.ONEBOTS_TUI_RESUME;
                const snapshot: unknown = JSON.parse(fs.readFileSync(resumePath, "utf8"));
                if (
                    !snapshot ||
                    typeof snapshot !== "object" ||
                    !("draft" in snapshot) ||
                    !snapshot.draft ||
                    typeof snapshot.draft !== "object" ||
                    Array.isArray(snapshot.draft) ||
                    ("source" in snapshot &&
                        snapshot.source !== undefined &&
                        typeof snapshot.source !== "string")
                )
                    throw new Error("工作区交接数据无效");
                workspace.resume({
                    source: "source" in snapshot ? (snapshot.source as string) : undefined,
                    draft: snapshot.draft as Record<string, unknown>,
                });
            }
            const installationRequest = process.env.ONEBOTS_INSTALLATION_REQUEST;
            if (installationRequest) {
                delete process.env.ONEBOTS_INSTALLATION_REQUEST;
                const plan = readInstallationRequest(installationRequest);
                await loadSelection(plan.selection, workspace.root);
                workspace.select(plan.selection);
            }
            if (options.selection) {
                const previous = workspace.selection;
                workspace.select({
                    adapters: options.selection.adapters.length
                        ? options.selection.adapters
                        : previous.adapters,
                    protocols: options.selection.protocols.length
                        ? options.selection.protocols
                        : previous.protocols,
                    applications: options.selection.applications?.length
                        ? options.selection.applications
                        : previous.applications,
                });
            }
            const local = localRuntimeBin(workspace.root);
            if (local) {
                await prompt.handoff(
                    local,
                    [
                        "ui",
                        "-c",
                        workspace.configPath,
                        ...(options.system ? ["--system"] : []),
                        ...(options.setup ? ["--setup"] : []),
                        ...(options.configure ? ["--configure"] : []),
                    ],
                    workspace.root,
                );
                return;
            }
            await runTuiSession(prompt, workspace, options);
        })()
            .then(() => exit())
            .catch(error => {
                if (!(error instanceof TuiCancelled)) {
                    process.exitCode = 1;
                    setMessage(error instanceof Error ? error.message : "工作台无法启动");
                }
                exit();
            });
        return () => active.current?.reject(new TuiCancelled());
    }, []);
    useEffect(() => {
        if (!handoff) return;
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-workspace-"));
        const file = path.join(directory, "draft.json");
        fs.writeFileSync(file, JSON.stringify(workspace.snapshot()), { mode: 0o600 });
        setRawMode(false);
        const child = spawn(process.execPath, [handoff.bin, ...handoff.args], {
            stdio: "inherit",
            cwd: handoff.root,
            env: { ...process.env, ONEBOTS_TUI_RESUME: file },
        });
        let finished = false;
        const finish = (error?: Error) => {
            if (finished) return;
            finished = true;
            fs.rmSync(directory, { recursive: true, force: true });
            if (error) {
                setHandoff(undefined);
                setRawMode(true);
                handoff.reject(error);
            } else handoff.resolve();
        };
        child.once("error", finish);
        child.once("exit", code =>
            finish(
                code === 0
                    ? undefined
                    : new Error("本地工作台未正常退出；原有配置仍保留，请重新运行 onebots ui"),
            ),
        );
        return () => {
            if (!finished) child.kill();
            fs.rmSync(directory, { recursive: true, force: true });
        };
    }, [handoff]);
    const finish = (value?: string[]) => {
        const request = active.current;
        active.current = undefined;
        setPending(undefined);
        if (value) request?.resolve(value);
        else request?.reject(new TuiCancelled());
    };
    if (handoff) return null;
    const summary = workspace.summary();
    const wide = (stdout.columns ?? 80) >= 90;
    return (
        <Box flexDirection="column" paddingX={1}>
            <Box justifyContent="space-between">
                <Text bold color="cyan">
                    OneBots 工作台
                </Text>
                <Text>
                    {isContainerRuntime() ? "容器" : options.system ? "系统服务" : "用户服务"} ·{" "}
                    {status}
                </Text>
            </Box>
            <Text dimColor wrap="truncate-end">
                {workspace.configPath}
            </Text>
            <Text color={summary.dirty || summary.needsRestart ? "yellow" : "green"}>
                {summary.conflict
                    ? "外部修改冲突"
                    : summary.dirty
                      ? "● 草稿未保存"
                      : summary.needsRestart
                        ? "● 已保存，待应用"
                        : !summary.configured
                          ? "尚未创建配置"
                          : "配置已同步"}
                {"  "}平台 {summary.adapters.length} · 账号 {summary.accounts.length} · 协议{" "}
                {summary.protocols.length} · 框架 {summary.frameworks.length}
            </Text>
            <Box flexDirection={wide ? "row" : "column"} marginTop={1}>
                <Box
                    flexDirection={wide ? "column" : "row"}
                    width={wide ? 14 : undefined}
                    flexShrink={0}
                    flexWrap="wrap">
                    {TERMINAL_PAGES.map((item, index) => (
                        <Text
                            key={item.id}
                            color={page === item.id ? "cyan" : "gray"}
                            bold={page === item.id}>
                            {index + 1} {item.label}{" "}
                        </Text>
                    ))}
                </Box>
                <Box flexDirection="column" flexGrow={1}>
                    {pending ? (
                        <PromptView
                            key={pending.id}
                            request={pending.request}
                            complete={finish}
                            cancel={() => finish()}
                        />
                    ) : (
                        <Text dimColor>{progress || "正在处理…"}</Text>
                    )}
                </Box>
            </Box>
            {progress && pending && (
                <Text color="yellow" wrap="truncate-end">
                    {progress}
                </Text>
            )}
            {message && <Text wrap="truncate-end">{message.replace(/\s+/gu, " ")}</Text>}
        </Box>
    );
}
