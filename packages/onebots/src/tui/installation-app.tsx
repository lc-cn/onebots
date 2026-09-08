import fs from "node:fs";
import path from "node:path";
import { useEffect, useRef, useState } from "react";
import { Box, Text, render, useApp } from "ink";
import { runInstallation } from "./onboarding.js";
import { PromptView, TuiCancelled, type PromptRequest } from "./prompt.js";
import { createDockerRequestBackend } from "../installation-request.js";
import {
    getRuntimePluginSelection,
    type RuntimePluginSelection,
} from "../runtime-plugin-selection.js";
import { load } from "js-yaml";

interface Pending {
    id: number;
    request: PromptRequest;
    resolve(answer: string[]): void;
    reject(error: Error): void;
}
/** 只负责交互与生成请求，不挂载 Docker socket，不加载用户插件、不写账号配置。 */
export function InstallationApp({
    directory,
    initial,
    retained,
}: {
    directory: string;
    initial: RuntimePluginSelection;
    retained: string[];
}) {
    const { exit } = useApp();
    const started = useRef(false);
    const [pending, setPending] = useState<Pending>();
    const [message, setMessage] = useState("");
    useEffect(() => {
        if (started.current) return;
        started.current = true;
        let id = 0;
        void runInstallation(
            {
                ask: request =>
                    new Promise((resolve, reject) =>
                        setPending({ id: ++id, request, resolve, reject }),
                    ),
                report: setMessage,
            },
            "/data",
            initial,
            createDockerRequestBackend(
                directory,
                retained,
                process.env.ONEBOTS_INSTALL_AUTH_AVAILABLE === "1",
            ),
        )
            .then(() => {
                exit();
            })
            .catch(error => {
                if (!(error instanceof TuiCancelled))
                    setMessage(error instanceof Error ? error.message : "安装请求失败");
                process.exitCode = 1;
                exit();
            });
    }, []);
    return (
        <Box flexDirection="column">
            <Text bold>OneBots 安装依赖</Text>
            <Text>{message}</Text>
            {pending && (
                <PromptView
                    key={pending.id}
                    request={pending.request}
                    complete={pending.resolve}
                    cancel={() => pending.reject(new TuiCancelled())}
                />
            )}
        </Box>
    );
}

if (process.argv[1] && path.resolve(process.argv[1]) === import.meta.filename) {
    const directory = process.argv[2];
    if (!directory || !process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error("安装向导需要终端和临时请求目录");
    let initial: RuntimePluginSelection = { adapters: [], protocols: [], applications: [] };
    const configFile = "/run/onebots/config.yaml";
    if (fs.existsSync(configFile)) {
        const config = load(fs.readFileSync(configFile, "utf8"));
        if (config && typeof config === "object" && !Array.isArray(config))
            initial = getRuntimePluginSelection(config as Record<string, unknown>) ?? initial;
    }
    const previous = JSON.parse(
        fs.readFileSync(path.join(directory, "previous-plan.json"), "utf8"),
    );
    const retained = Object.keys(previous);
    // 先初始化内置框架定义；表单阶段不导入任何第三方适配器。
    await import("../index.js");
    await render(
        <InstallationApp directory={directory} initial={initial} retained={retained} />,
    ).waitUntilExit();
}
