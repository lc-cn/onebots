import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Box, Text, render, useApp, useInput } from "ink";
import * as fs from "node:fs";
import { spawn } from "node:child_process";
import yaml from "js-yaml";
import { ServiceController, type ServiceScope, type ServiceStatus } from "./service-manager.js";
import { runDoctor, type DoctorReport } from "./doctor.js";

export interface UiOptions { configPath: string; scope: ServiceScope; webOnly?: boolean }

/** 根据桥接配置计算 Web 管理端地址。 */
export function getWebUrl(configPath: string): string {
    const config = fs.existsSync(configPath)
        ? ((yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>) || {})
        : {};
    const configuredPath = String(config.path ?? "").trim();
    const suffix = configuredPath ? `/${configuredPath.replace(/^\/+/, "")}` : "";
    return `http://127.0.0.1:${Number(config.port ?? 6727)}${suffix}`.replace(/\/$/, "");
}

/** 使用当前操作系统的默认浏览器打开地址。 */
export async function openWeb(url: string): Promise<void> {
    const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "cmd.exe" : "xdg-open";
    const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, { detached: true, stdio: "ignore" });
        child.once("error", reject);
        child.once("spawn", () => { child.unref(); resolve(); });
    });
}

/** 打开轻量终端面板，或直接跳转 Web 管理端。 */
export async function runUi(options: UiOptions): Promise<void> {
    const url = getWebUrl(options.configPath);
    if (options.webOnly) {
        try { await openWeb(url); console.log(`已打开 ${url}`); }
        catch { console.log(`无法打开浏览器，请访问: ${url}`); }
        return;
    }
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error("onebots ui 需要交互式终端；可使用 onebots ui --web");
    const instance = render(<Dashboard {...options} url={url} />);
    await instance.waitUntilExit();
}

function Dashboard({ configPath, scope, url }: UiOptions & { url: string }) {
    const controller = useMemo(() => new ServiceController(scope), [scope]);
    const { exit } = useApp();
    const [status, setStatus] = useState<ServiceStatus>(() => controller.status());
    const [logs, setLogs] = useState("正在读取日志…");
    const [message, setMessage] = useState("");
    const [doctor, setDoctor] = useState<DoctorReport | null>(null);
    const [health, setHealth] = useState("未检查");

    const refresh = useCallback(async () => {
        setStatus(controller.status());
        try { setLogs(await controller.logs({ lines: 12 })); }
        catch (error) { setLogs((error as Error).message); }
        try {
            const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) });
            setHealth(response.ok ? "健康" : `HTTP ${response.status}`);
        } catch { setHealth("不可达"); }
    }, [controller, url]);

    useEffect(() => {
        void refresh();
        const timer = setInterval(() => void refresh(), 3000);
        return () => clearInterval(timer);
    }, [refresh]);

    const act = useCallback(async (name: string, action: () => Promise<void>) => {
        setMessage(`${name}中…`);
        try { await action(); setMessage(`${name}完成`); }
        catch (error) { setMessage(`${name}失败: ${(error as Error).message}`); }
        await refresh();
    }, [refresh]);

    useInput((input, key) => {
        if (input === "q" || key.escape) return exit();
        if (input === "s") void act("启动", () => controller.start());
        if (input === "x") void act("停止", () => controller.stop());
        if (input === "r") void act("重启", () => controller.restart());
        if (input === "o") void openWeb(url).then(() => setMessage(`已打开 ${url}`)).catch(() => setMessage(`请访问 ${url}`));
        if (input === "d") void runDoctor({ configPath, adapters: [], protocols: [], scope }).then(setDoctor);
        if (input === "l") void refresh();
    });

    return <Box flexDirection="column" paddingX={1}>
        <Box borderStyle="round" paddingX={1} flexDirection="column">
            <Text bold color="cyan">OneBots 桥接服务</Text>
            <Text>Scope: {scope}  状态: <Text color={status.running ? "green" : status.installed ? "yellow" : "red"}>{status.running ? "运行中" : status.installed ? "已停止" : "未安装"}</Text></Text>
            <Text>Health: {health}</Text>
            <Text>Web: {url}</Text>
        </Box>
        <Box borderStyle="round" paddingX={1} flexDirection="column" marginTop={1}>
            <Text bold>最近日志</Text>
            <Text>{logs || "暂无日志"}</Text>
        </Box>
        {doctor && <Box marginTop={1}><Text color={doctor.ok ? "green" : "red"}>Doctor: {doctor.ok ? "通过" : `${doctor.checks.filter(item => item.level === "error").length} 个错误`}</Text></Box>}
        {message && <Text color="yellow">{message}</Text>}
        <Text dimColor>[s] 启动  [x] 停止  [r] 重启  [l] 刷新  [d] 诊断  [o] Web  [q] 退出</Text>
    </Box>;
}
