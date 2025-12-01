import { BaseApp, yaml, AdapterRegistry, ProtocolRegistry, configure, Protocol, Adapter, readLine } from "@onebots/core";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
import koaStatic from "koa-static";
import { copyFileSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import type { WsServer, Dict } from "@onebots/core";
import * as pty from "@karinjs/node-pty";

const require = createRequire(import.meta.url);
const client = path.resolve(import.meta.dirname, '../node_modules/@onebots/client/dist');

export class App extends BaseApp {
    public ws: WsServer;
    private logCacheFile: string;
    private logWriteStream: fs.WriteStream;
    private logClients: Set<any> = new Set();
    private ptyTerminal: any = null;
    private terminalClients: Set<any> = new Set();

    constructor(config: App.Config) {
        super(config);

        // 1. 初始化日志缓存文件
        this.logCacheFile = path.join(process.cwd(), 'data', 'terminal-logs.txt');
        this.initLogCache();

        // 2. 初始化 WebSocket
        this.ws = this.router.ws("/");

        // 2.1 初始化 PTY 终端 WebSocket
        const terminalWs = this.router.ws("/api/terminal");

        // 设置 PTY WebSocket 连接处理
        terminalWs.on("connection", (client) => {
            // 创建 PTY 终端实例（如果不存在）
            if (!this.ptyTerminal) {
                const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
                this.ptyTerminal = pty.spawn(shell, [], {
                    name: 'xterm-256color',
                    cols: 80,
                    rows: 30,
                    cwd: process.cwd(),
                    env: {
                        ...process.env,
                        TERM: 'xterm-256color',
                        COLORTERM: 'truecolor'
                    } as any
                });

                // 监听 PTY 输出
                this.ptyTerminal.onData((data: string) => {
                    // 广播到所有连接的客户端
                    this.terminalClients.forEach(c => {
                        try {
                            c.send(JSON.stringify({ type: 'output', data }));
                        } catch (e) {
                            this.terminalClients.delete(c);
                        }
                    });
                });

                // 监听 PTY 退出
                this.ptyTerminal.onExit(() => {
                    this.ptyTerminal = null;
                    this.terminalClients.forEach(c => {
                        try {
                            c.send(JSON.stringify({ type: 'exit' }));
                        } catch (e) { }
                    });
                    this.terminalClients.clear();
                });
            }

            // 添加到客户端列表
            this.terminalClients.add(client);

            // 监听客户端消息（用户输入）
            client.on("message", (msg) => {
                try {
                    const payload = JSON.parse(msg.toString());
                    if (payload.type === 'input' && this.ptyTerminal) {
                        this.ptyTerminal.write(payload.data);
                    } else if (payload.type === 'resize' && this.ptyTerminal) {
                        this.ptyTerminal.resize(payload.cols, payload.rows);
                    } else if (payload.type === 'restart') {
                        // 通知所有客户端
                        this.terminalClients.forEach(c => {
                            try {
                                c.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[33m[服务即将重启]\x1b[0m' }));
                            } catch (e) {}
                        });
                        setTimeout(() => process.exit(100), 500);
                    }
                } catch (e) {
                    console.error('终端消息处理失败:', e);
                }
            });

            // 监听客户端断开
            client.on("close", () => {
                this.terminalClients.delete(client);
                // 如果没有客户端了，关闭 PTY
                if (this.terminalClients.size === 0 && this.ptyTerminal) {
                    this.ptyTerminal.kill();
                    this.ptyTerminal = null;
                }
            });
        });

        // 3. 监听进程退出，清空缓存
        process.on('exit', () => {
            this.cleanupLogCache();
        });
        process.on('SIGINT', () => {
            this.cleanupLogCache();
            process.exit();
        });
        process.on('SIGTERM', () => {
            this.cleanupLogCache();
            process.exit();
        });
    }

    private initLogCache() {
        // 确保 data 目录存在
        const dataDir = path.dirname(this.logCacheFile);
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true });
        }

        // 清空旧的日志缓存文件（重启时清空）
        writeFileSync(this.logCacheFile, '', 'utf-8');

        // 创建写入流
        this.logWriteStream = fs.createWriteStream(this.logCacheFile, { flags: 'a', encoding: 'utf-8' });

        // 拦截 stdout 和 stderr 的 write 方法
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);

        process.stdout.write = ((chunk: any, encoding?: any, callback?: any) => {
            const message = chunk.toString();
            // 缓存到文件
            this.cacheLog(message);
            // 广播到所有 SSE 客户端
            this.broadcastLog(message);
            // 继续正常输出
            return originalStdoutWrite(chunk, encoding, callback);
        }) as any;

        process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
            const message = chunk.toString();
            // 缓存到文件
            this.cacheLog(message);
            // 广播到所有 SSE 客户端
            this.broadcastLog(message);
            // 继续正常输出
            return originalStderrWrite(chunk, encoding, callback);
        }) as any;
    }

    private broadcastLog(message: string) {
        if (this.logClients.size > 0 && message) {
            // 将 \n 替换为 \r\n 以适配 xterm.js
            const terminalMessage = message.replace(/\n/g, '\r\n');
            const data = `data: ${JSON.stringify({ message: terminalMessage })}\n\n`;

            this.logClients.forEach(client => {
                try {
                    client.write(data);
                } catch (e) {
                    this.logClients.delete(client);
                }
            });
        }
    }

    private cleanupLogCache() {
        // 关闭写入流
        if (this.logWriteStream) {
            this.logWriteStream.end();
        }
        // 清空缓存文件
        try {
            if (existsSync(this.logCacheFile)) {
                writeFileSync(this.logCacheFile, '', 'utf-8');
            }
        } catch (e) {
            console.error('清空日志缓存失败:', e);
        }
    }


    private cacheLog(message: string) {
        if (this.logWriteStream && message) {
            this.logWriteStream.write(message);
        }
    }

    async start() {
        // WebSocket 日志监听
        const fileListener = e => {
            if (e === "change")
                this.ws.clients.forEach(async client => {
                    client.send(
                        JSON.stringify({
                            event: "system.log",
                            data: await readLine(1, BaseApp.logFile),
                        }),
                    );
                });
        };
        fs.watch(BaseApp.logFile, fileListener);
        this.once("close", () => {
            fs.unwatchFile(BaseApp.logFile, fileListener);
        });
        process.once("disconnect", () => {
            fs.unwatchFile(BaseApp.logFile, fileListener);
        });

        // WebSocket 连接处理
        this.ws.on("connection", async client => {
            client.send(
                JSON.stringify({
                    event: "system.sync",
                    data: {
                        config: fs.readFileSync(BaseApp.configPath, "utf8"),
                        adapters: [...this.adapters.values()].map(adapter => {
                            return adapter.info;
                        }),
                        protocol: ProtocolRegistry.getAllMetadata(),
                        app: this.info,
                        logs: fs.existsSync(BaseApp.logFile) ? await readLine(100, BaseApp.logFile) : "",
                    },
                }),
            );
            client.on("message", async raw => {
                let payload: Dict = {};
                try {
                    payload = JSON.parse(raw.toString());
                } catch {
                    return;
                }
                switch (payload.action) {
                    case "system.input":
                        // 将流的模式切换到"流动模式"
                        process.stdin.resume();

                        // 使用以下函数来模拟输入数据
                        function simulateInput(data: Buffer) {
                            process.nextTick(() => {
                                process.stdin.emit("data", data);
                            });
                        }

                        simulateInput(Buffer.from(payload.data + "\n", "utf8"));
                        // 模拟结束
                        process.nextTick(() => {
                            process.stdin.emit("end");
                        });
                        return true;
                    case "system.saveConfig":
                        return fs.writeFileSync(BaseApp.configPath, payload.data, "utf8");
                    case "system.reload":
                        const config = yaml.load(fs.readFileSync(BaseApp.configPath, "utf8"));
                        return this.reload(config);
                    case "bot.start": {
                        const { platform, uin } = JSON.parse(payload.data);
                        await this.adapters.get(platform)?.setOnline(uin);
                        return client.send(
                            JSON.stringify({
                                event: "bot.change",
                                data: this.adapters.get(platform).getAccount(uin).info,
                            }),
                        );
                    }
                    case "bot.stop": {
                        const { platform, uin } = JSON.parse(payload.data);
                        await this.adapters.get(platform)?.setOffline(uin);
                        return client.send(
                            JSON.stringify({
                                event: "bot.change",
                                data: this.adapters.get(platform).getAccount(uin).info,
                            }),
                        );
                    }
                }
            });
        });

        // 创建 /api 路由
        const apiRouter = this.router.prefix('/api');

        // 管理端点
        apiRouter.get("/adapters", ctx => {
            ctx.body = [...this.adapters.values()].map(adapter => adapter.info);
        });

        apiRouter.get("/system", ctx => {
            ctx.body = this.info;
        });

        // PTY 终端 WebSocket 端点
        const terminalWs = this.router.ws("/api/terminal");
        terminalWs.on("connection", (client) => {
            // 创建 PTY 终端实例（如果不存在）
            if (!this.ptyTerminal) {
                const shell = process.platform === 'win32' ? 'powershell.exe' : 'bash';
                this.ptyTerminal = pty.spawn(shell, [], {
                    name: "xterm-color",
                    cols: 80,
                    rows: 30,
                    cwd: process.env.HOME,
                    env: process.env,
                });

                // 监听 PTY 输出
                this.ptyTerminal.onData((data) => {
                    // 广播到所有连接的客户端
                    this.terminalClients.forEach(c => {
                        try {
                            c.send(JSON.stringify({ type: 'output', data }));
                        } catch (e) {
                            this.terminalClients.delete(c);
                        }
                    });
                });

                // 监听 PTY 退出
                this.ptyTerminal.onExit(() => {
                    this.ptyTerminal = null;
                    this.terminalClients.forEach(c => {
                        try {
                            c.send(JSON.stringify({ type: 'exit' }));
                        } catch (e) { }
                    });
                    this.terminalClients.clear();
                });
            }

            // 添加到客户端列表
            this.terminalClients.add(client);

            // 监听客户端消息（用户输入）
            client.on("message", (msg) => {
                try {
                    const payload = JSON.parse(msg.toString());
                    if (payload.type === 'input' && this.ptyTerminal) {
                        this.ptyTerminal.write(payload.data);
                    } else if (payload.type === 'resize' && this.ptyTerminal) {
                        this.ptyTerminal.resize(payload.cols, payload.rows);
                    }
                } catch (e) {
                    console.error('终端消息处理失败:', e);
                }
            });

            // 监听客户端断开
            client.on("close", () => {
                this.terminalClients.delete(client);
                // 如果没有客户端了，关闭 PTY
                if (this.terminalClients.size === 0 && this.ptyTerminal) {
                    this.ptyTerminal.kill();
                    this.ptyTerminal = null;
                }
            });
        });

        // 日志流 SSE 端点
        apiRouter.get("/logs", ctx => {
            ctx.request.socket.setTimeout(0);
            ctx.req.socket.setNoDelay(true);
            ctx.req.socket.setKeepAlive(true);
            ctx.set({
                'Content-Type': 'text/event-stream',
                'Cache-Control': 'no-cache',
                'Connection': 'keep-alive',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Headers': 'Content-Type'
            });
            ctx.status = 200;

            // 阻止 Koa 自动结束响应
            ctx.respond = false;

            // 添加到客户端列表
            this.logClients.add(ctx.res);

            // 发送缓存日志到客户端
            try {
                if (existsSync(this.logCacheFile)) {
                    const cachedLogs = readFileSync(this.logCacheFile, 'utf-8');
                    if (cachedLogs) {
                        // 将历史日志的 \n 也替换为 \r\n
                        const terminalLogs = cachedLogs.replace(/\n/g, '\r\n');
                        ctx.res.write(`data: ${JSON.stringify({ message: terminalLogs })}\n\n`);
                    }
                }
            } catch (error) {
                console.error('读取日志缓存失败:', error);
            }
            // 定时发送心跳
            const heartbeat = setInterval(() => {
                try {
                    ctx.res.write(': heartbeat\n\n');
                } catch (error) {
                    clearInterval(heartbeat);
                    this.logClients.delete(ctx.res);
                }
            }, 30000);

            // 监听连接关闭
            ctx.req.on('close', () => {
                clearInterval(heartbeat);
                this.logClients.delete(ctx.res);
            });
        });

        // 配置接口
        apiRouter.get("/config", ctx => {
            ctx.body = fs.readFileSync(BaseApp.configPath, "utf8");
        });

        apiRouter.post("/config", ctx => {
            try {
                // koa-bodyparser 会把 text/plain 解析为字符串
                const configContent = ctx.request.body as string;
                fs.writeFileSync(BaseApp.configPath, configContent, "utf8");
                ctx.body = { success: true, message: "配置已保存" };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        // 账号管理端点
        apiRouter.get("/list", ctx => {
            ctx.body = this.accounts.map(bot => bot.info);
        });

        apiRouter.post("/add", ctx => {
            const config = ctx.request.body as any;
            try {
                this.addAccount(config);
                ctx.body = { success: true, message: '添加成功' };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        apiRouter.post("/edit", ctx => {
            const config = ctx.request.body as any;
            try {
                this.updateAccount(config);
                ctx.body = { success: true, message: '修改成功' };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        apiRouter.get("/remove", ctx => {
            const { uin, platform, force } = ctx.request.query;
            try {
                this.removeAccount(String(platform), String(uin), Boolean(force));
                ctx.body = { success: true, message: '移除成功' };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        // 静态文件服务
        if (fs.existsSync(client)) {
            this.use(koaStatic(client));
            // SPA fallback
            this.use(async (ctx) => {
                if (!ctx.path.startsWith(this.config.path || '')) {
                    ctx.type = 'html';
                    ctx.body = fs.readFileSync(path.join(client, 'index.html'));
                }
            });
        }

        // 调用父类的 start
        await super.start();
    }
}
export namespace App {
    export interface Config extends BaseApp.Config { }
    export const defaultConfig: Config = {
        ...BaseApp.defaultConfig,
    }
    export function registerGeneral<K extends keyof Protocol.Configs>(
        key: K,
        config: Protocol.Config<Protocol.Configs[K]>,
    ) {
        defaultConfig.general = {
            ...defaultConfig.general,
            [key]: config
        }
    }
    export async function registerAdapter(platform: string)
    export async function registerAdapter(platform: string, factory: Adapter.Factory)
    export async function registerAdapter(platform: string, factory?: Adapter.Factory) {
        if (!factory) factory = await loadAdapterFactory(platform);
        AdapterRegistry.register(platform, factory);
    }
    export async function registerProtocol(name: string, version?: string)
    export async function registerProtocol(name: string, factory: Protocol.Factory, version?: string,)
    export async function registerProtocol(name: string, ...args: [Protocol.Factory, string?] | [string?]) {
        let factory: Protocol.Factory | undefined = typeof args[0] === "string" ? undefined : args[0];
        let version: string = typeof args[0] === "string" ? args[0] : args[1];
        if (!factory) factory = await loadProtocolFactory(name, version);
        ProtocolRegistry.register(name, version, factory);
    }
    export async function loadAdapterFactory(platform: string): Promise<Adapter.Factory> {
        const maybeNames = [
            `@onebots/adapter-${platform}`,
            `onebots-adapter-${platform}`,
            platform
        ];
        const errors: string[] = [];
        for (const name of maybeNames) {
            try {
                const entry = require.resolve(name);
                const mod = await import(entry);
                if (mod.default) return mod.default;
            } catch (e) { errors.push(e.toString()); }
        }
        throw new Error(errors.join("\n"))
    }
    export async function loadProtocolFactory(name: string, version?: string): Promise<Protocol.Factory> {
        const fullName = [name, version].filter(Boolean).join("-");
        const maybeNames = [
            `@onebots/protocol-${fullName}`,
            `onebots-protocol-${fullName}`,
            `${fullName}`
        ];
        const errors: string[] = [];
        for (const modName of maybeNames) {
            try {
                const entry = require.resolve(modName);
                const mod = await import(entry);
                if (mod.default) return mod.default;
            } catch (e) { errors.push(e.toString()); }
        }
        throw new Error(errors.join("\n"));
    }
}
export function createOnebots(
    config: BaseApp.Config | string = "config.yaml",
    // cp: ChildProcess | null = null,
) {
    const isStartWithConfigFile = typeof config === "string";
    if (isStartWithConfigFile) {
        config = path.resolve(process.cwd(), config as string);
        BaseApp.configDir = path.dirname(config);
    }
    if (!existsSync(BaseApp.configDir)) mkdirSync(BaseApp.configDir);
    if (!existsSync(BaseApp.configPath) && isStartWithConfigFile) {
        copyFileSync(path.resolve(__dirname, "../config.sample.yaml"), BaseApp.configPath);
        console.log("未找到对应配置文件，已自动生成默认配置文件，请修改配置文件后重新启动");
        console.log(`配置文件在:  ${BaseApp.configPath}`);
        process.exit();
    }
    if (!isStartWithConfigFile) {
        writeFileSync(BaseApp.configPath, yaml.dump(config));
        console.log(`已自动保存配置到：${BaseApp.configPath}`);
    }
    if (!existsSync(BaseApp.dataDir)) {
        mkdirSync(BaseApp.dataDir);
        console.log("已为你创建数据存储目录", BaseApp.dataDir);
    }
    config = yaml.load(readFileSync(BaseApp.configPath, "utf8")) as BaseApp.Config;
    configure({
        appenders: {
            out: {
                type: "stdout",
                layout: { type: "colored" },
            },
            files: {
                type: "file",
                maxLogSize: 1024 * 1024 * 50,
                filename: path.join(process.cwd(), "onebots.log"),
            },
        },
        categories: {
            default: {
                appenders: ["out", "files"],
                level: (config as BaseApp.Config).log_level || "info",
            },
        },
        disableClustering: true,
    });
    // if (cp) process.on("disconnect", () => cp.kill());
    return new App(config as BaseApp.Config);
}

export function defineConfig(config: BaseApp.Config) {
    return config;
}