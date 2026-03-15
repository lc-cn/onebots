/**
 * OneBots CLI：gateway 网关控制、config、setup、onboard、send
 */
import { Command } from "commander";
import * as path from "path";
import * as fs from "fs";
import { createOnebots, App } from "./app.js";
import { BaseApp, yaml } from "@onebots/core";
import {
    getPidPath,
    readPid,
    writePid,
    removePidFile,
    isProcessRunning,
    stopProcess,
    daemonStart,
} from "./daemon.js";
import {
    serviceInstall,
    serviceUninstall,
    serviceStatus,
} from "./service-manager.js";

const program = new Command();

program
    .name("onebots")
    .description("OneBots CLI - 网关控制与配置管理")
    .version("1.0.1")
    .option("-c, --config <path>", "配置文件路径", "config.yaml")
    .option("-r, --register <adapter>", "注册适配器（可多次）", collect, [])
    .option("-p, --protocol <protocol>", "注册协议（可多次）", collect, []);

function collect(val: string, prev: string[]): string[] {
    return (prev || []).concat([val]);
}

function getConfigPath(configOption: string): string {
    return path.resolve(process.cwd(), configOption);
}

async function loadAdaptersAndProtocols(adapters: string[], protocols: string[]): Promise<void> {
    for (const adapter of adapters) {
        const ok = await App.loadAdapterFactory(adapter);
        if (!ok) {
            console.warn(`[onebots] 加载适配器 ${adapter} 失败，请检查是否已安装`);
        }
    }
    for (const protocol of protocols) {
        await App.loadProtocolFactory(protocol);
    }
}

async function runGatewayStart(configPath: string, adapters: string[], protocols: string[]): Promise<void> {
    await loadAdaptersAndProtocols(adapters, protocols);
    createOnebots(configPath).start();
}

// ---------- gateway 子命令 ----------
const gateway = program.command("gateway").description("网关服务（start/daemon/stop/service）");

gateway
    .command("start")
    .description("前台启动网关")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        await runGatewayStart(configPath, opts.register || [], opts.protocol || []);
    });

gateway
    .command("daemon")
    .description("后台启动网关")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        await loadAdaptersAndProtocols(opts.register || [], opts.protocol || []);
        const pid = daemonStart({
            configPath,
            adapters: opts.register || [],
            protocols: opts.protocol || [],
            nodePath: process.execPath,
            binPath: process.argv[1],
        });
        writePid(configPath, pid);
        console.log(`网关已在后台启动，PID: ${pid}`);
        console.log(`PID 文件: ${getPidPath(configPath)}`);
        process.exit(0);
    });

gateway
    .command("stop")
    .description("停止网关")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        const pid = readPid(configPath);
        if (pid === null) {
            console.error("[onebots] 未找到 PID 文件，网关可能未以后台方式运行");
            process.exit(2);
        }
        if (!isProcessRunning(pid)) {
            console.warn("[onebots] 进程已不存在，清理 PID 文件");
            removePidFile(configPath);
            process.exit(0);
        }
        stopProcess(pid);
        removePidFile(configPath);
        console.log("网关已停止");
        process.exit(0);
    });

const gatewayService = gateway.command("service").description("系统服务（install/uninstall/status）");

gatewayService
    .command("install")
    .description("安装网关为系统服务")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        await serviceInstall(configPath);
    });

gatewayService
    .command("uninstall")
    .description("卸载网关系统服务")
    .action(async () => {
        await serviceUninstall();
    });

gatewayService
    .command("status")
    .description("查看网关服务状态")
    .action(async () => {
        await serviceStatus();
    });

// ---------- config 子命令 ----------
const configCmd = program.command("config").description("命令式修改配置（get/set/list）");

configCmd
    .command("get <key>")
    .description("获取配置项")
    .action(async (key: string) => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        if (!fs.existsSync(configPath)) {
            console.error("[onebots] 配置文件不存在，请先运行 onebots setup");
            process.exit(1);
        }
        const raw = fs.readFileSync(configPath, "utf8");
        const config: Record<string, unknown> = (yaml.load(raw) as Record<string, unknown>) || {};
        const keys = key.split(".");
        let cur: unknown = config;
        for (const k of keys) {
            cur = (cur as Record<string, unknown>)?.[k];
            if (cur === undefined) break;
        }
        console.log(cur === undefined ? "" : String(cur));
    });

configCmd
    .command("set <key> <value>")
    .description("设置配置项")
    .action(async (key: string, value: string) => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        if (!fs.existsSync(configPath)) {
            console.error("[onebots] 配置文件不存在，请先运行 onebots setup");
            process.exit(1);
        }
        const raw = fs.readFileSync(configPath, "utf8");
        const config: Record<string, unknown> = (yaml.load(raw) as Record<string, unknown>) || {};
        const keys = key.split(".");
        let cur: Record<string, unknown> = config;
        for (let i = 0; i < keys.length - 1; i++) {
            const k = keys[i];
            if (!(cur[k] instanceof Object)) cur[k] = {};
            cur = cur[k] as Record<string, unknown>;
        }
        const last = keys[keys.length - 1];
        const num = Number(value);
        cur[last] = value === "true" ? true : value === "false" ? false : Number.isNaN(num) ? value : num;
        fs.writeFileSync(configPath, yaml.dump(config), "utf8");
        console.log(`已设置 ${key} = ${value}`);
    });

configCmd
    .command("list")
    .description("列出全部配置")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        if (!fs.existsSync(configPath)) {
            console.error("[onebots] 配置文件不存在，请先运行 onebots setup");
            process.exit(1);
        }
        const raw = fs.readFileSync(configPath, "utf8");
        const config: Record<string, unknown> = (yaml.load(raw) as Record<string, unknown>) || {};
        console.log(yaml.dump(config));
    });

// ---------- setup ----------
program
    .command("setup")
    .description("初始化 OneBots（创建配置目录与默认配置）")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        const configDir = path.dirname(configPath);
        if (fs.existsSync(configPath)) {
            console.log("配置文件已存在:", configPath);
            process.exit(0);
        }
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }
        const samplePath = path.resolve(import.meta.dirname, "./config.sample.yaml");
        fs.copyFileSync(samplePath, configPath);
        const dataDir = path.join(configDir, "data");
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        console.log("已初始化，配置文件:", configPath);
        console.log("请修改配置后使用 onebots gateway start 启动");
        process.exit(0);
    });

// ---------- onboard ----------
program
    .command("onboard")
    .description("引导式调整配置")
    .action(async () => {
        const opts = program.opts();
        const configPath = getConfigPath(opts.config);
        if (!fs.existsSync(configPath)) {
            console.error("[onebots] 请先运行 onebots setup");
            process.exit(1);
        }
        const readline = await import("readline");
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        const ask = (q: string): Promise<string> =>
            new Promise((resolve) => rl.question(q, resolve));
        let config: Record<string, unknown> = (yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>) || {};
        const port = await ask("HTTP 端口 [6727]: ");
        if (port) (config as Record<string, unknown>).port = parseInt(port, 10) || 6727;
        const logLevel = await ask("日志级别 (trace/debug/info/warn/error) [info]: ");
        if (logLevel) (config as Record<string, unknown>).log_level = logLevel || "info";
        fs.writeFileSync(configPath, yaml.dump(config), "utf8");
        console.log("配置已更新:", configPath);
        rl.close();
        process.exit(0);
    });

// ---------- send ----------
program
    .command("send <target_id> <message>")
    .description("通过已运行的网关发送消息")
    .requiredOption("--target_type <type>", "private | group | channel")
    .requiredOption("--channel <channel>", "发信 bot，格式 platform.account_id（如 qq.my_bot）")
    .option("--url <baseUrl>", "网关 base URL（默认从 -c 读取 port/path 构造）")
    .action(async (target_id: string, message: string, options: { target_type: string; channel: string; url?: string }) => {
        const opts = program.opts();
        let baseUrl = options.url;
        let auth: Record<string, string> = {};
        if (!baseUrl) {
            const configPath = getConfigPath(opts.config);
            if (!fs.existsSync(configPath)) {
                console.error("[onebots] 配置文件不存在，请指定 -c 或 --url");
                process.exit(1);
            }
            const config = yaml.load(fs.readFileSync(configPath, "utf8")) as {
                port?: number;
                path?: string;
                username?: string;
                password?: string;
                access_token?: string;
            };
            const port = config?.port ?? 6727;
            const pathPrefix = config?.path ?? "";
            baseUrl = `http://127.0.0.1:${port}${pathPrefix}`;
            if (config?.access_token) {
                auth = { Authorization: `Bearer ${config.access_token}` };
            } else if (config?.username && config?.password) {
                auth = {
                    Authorization: "Basic " + Buffer.from(`${config.username}:${config.password}`).toString("base64"),
                };
            }
        }
        const body = {
            channel: options.channel,
            target_id,
            target_type: options.target_type,
            message: message || "",
        };
        try {
            const res = await fetch(`${baseUrl.replace(/\/$/, "")}/api/send`, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...auth },
                body: JSON.stringify(body),
            });
            const text = await res.text();
            if (!res.ok) {
                console.error("[onebots] 发送失败:", res.status, text);
                process.exit(2);
            }
            console.log(text || "发送成功");
        } catch (e) {
            console.error("[onebots] 请求失败，请确认网关已启动（onebots gateway start 或 onebots gateway daemon）:", e);
            process.exit(2);
        }
        process.exit(0);
    });

// 无子命令时默认执行 gateway start（仅当没有未被选项消耗的剩余参数时）
program.action(async () => {
    // 使用 program.args：Commander 解析后只包含未被 -r/-p/-c 等消耗的剩余参数。
    // 用 process.argv 会把 -r/-p 的值（如 kook、config.yaml）误判为位置参数导致不启动。
    if (program.args.length > 0) return; // 有剩余位置参数则交给 Commander 显示 unknown command
    const opts = program.opts();
    const configPath = getConfigPath(opts.config);
    await runGatewayStart(configPath, opts.register || [], opts.protocol || []);
});

export function runCli(): void {
    program.parse();
}
