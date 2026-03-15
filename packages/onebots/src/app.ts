import {
    BaseApp,
    yaml,
    RouterContext,
    ProtocolRegistry,
    configure,
    Protocol,
    readLine,
    createManagedTokenValidator,
    initTokenManager,
} from "@onebots/core";
import { getAppConfigSchema } from "./config-schema.js";
import * as path from "path";
import * as fs from "fs";
import { createRequire } from "module";
import { pathToFileURL } from "url";
import koaStatic from "koa-static";
import { copyFileSync, existsSync, writeFileSync, mkdirSync, readFileSync } from "fs";
import type { WsServer, Dict } from "@onebots/core";
import * as pty from "@karinjs/node-pty";

const require = createRequire(pathToFileURL(path.join(process.cwd(), 'node_modules')));
const client = path.resolve(path.join(process.cwd(), 'node_modules/@onebots/web/dist'));

export class App extends BaseApp {
    public ws: WsServer;
    private logCacheFile: string;
    private logWriteStream: fs.WriteStream;
    private logClients: Set<any> = new Set();
    private ptyTerminal: any = null;
    private terminalClients: Set<any> = new Set();
    private tokenManager = initTokenManager({
        defaultExpiration: 12 * 60 * 60 * 1000,
        refreshExpiration: 7 * 24 * 60 * 60 * 1000,
    });

    constructor(config: App.Config) {
        super(config);

        // 1. 初始化日志缓存文件
        this.logCacheFile = path.join(process.cwd(), 'data', 'terminal-logs.txt');
        this.initLogCache();

        // 2. 初始化 WebSocket
        this.ws = this.router.ws("/");

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
            try {
                // 缓存到文件
                this.cacheLog(message);
                // 广播到所有 SSE 客户端
                this.broadcastLog(message);
            } catch (e) {
                // Use the original write to avoid re-entering the interceptor
                originalStderrWrite(`[onebots] Log interceptor error: ${e}\n`);
            }
            // 继续正常输出
            return originalStdoutWrite(chunk, encoding, callback);
        }) as any;

        process.stderr.write = ((chunk: any, encoding?: any, callback?: any) => {
            const message = chunk.toString();
            try {
                // 缓存到文件
                this.cacheLog(message);
                // 广播到所有 SSE 客户端
                this.broadcastLog(message);
            } catch (e) {
                // Use the original write to avoid re-entering the interceptor
                originalStderrWrite(`[onebots] Log interceptor error: ${e}\n`);
            }
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
        const authValidator = createManagedTokenValidator(this.tokenManager, {
            tokenName: 'access_token',
            errorMessage: 'Unauthorized',
        });
        const expectedUsername = this.config.username ?? BaseApp.defaultConfig.username;
        const expectedPassword = this.config.password ?? BaseApp.defaultConfig.password;
        const getTokenFromRequest = (request: import('http').IncomingMessage) => {
            const authHeader = request.headers.authorization;
            if (authHeader && typeof authHeader === 'string') {
                const match = authHeader.match(/^Bearer\s+(.+)$/i);
                return match ? match[1] : authHeader;
            }
            try {
                const url = new URL(request.url || '/', 'http://localhost');
                return url.searchParams.get('access_token') || undefined;
            } catch {
                return undefined;
            }
        };

        this.router.post("/api/auth/login", (ctx: RouterContext) => {
            const { username, password } = ctx.request.body as { username?: string; password?: string };
            if (!username || !password || username !== expectedUsername || password !== expectedPassword) {
                ctx.status = 401;
                ctx.body = { success: false, message: "用户名或密码错误" };
                return;
            }
            const tokenInfo = this.tokenManager.generateToken({ username });
            ctx.body = {
                success: true,
                token: tokenInfo.token,
                expiresAt: tokenInfo.expiresAt,
                refreshToken: tokenInfo.refreshToken,
            };
        });

        this.router.post("/api/auth/refresh", (ctx: RouterContext) => {
            const { refreshToken } = ctx.request.body as { refreshToken?: string };
            if (!refreshToken) {
                ctx.status = 400;
                ctx.body = { success: false, message: "缺少 refreshToken" };
                return;
            }
            const tokenInfo = this.tokenManager.refreshToken(refreshToken);
            if (!tokenInfo) {
                ctx.status = 401;
                ctx.body = { success: false, message: "refreshToken 无效或已过期" };
                return;
            }
            ctx.body = {
                success: true,
                token: tokenInfo.token,
                expiresAt: tokenInfo.expiresAt,
                refreshToken: tokenInfo.refreshToken,
            };
        });

        this.router.use('/api', async (ctx: RouterContext, next) => {
            if (ctx.path === '/api/auth/login' || ctx.path === '/api/auth/refresh') return next();
            return authValidator(ctx as any, next as any);
        });

        this.router.post("/api/auth/logout", (ctx: RouterContext) => {
            const token = ctx.state.token as string | undefined;
            if (token) this.tokenManager.revokeToken(token);
            ctx.body = { success: true };
        });

        this.router.get("/api/auth/me", (ctx: RouterContext) => {
            const tokenInfo = ctx.state.tokenInfo as { expiresAt?: number; metadata?: Record<string, any> } | undefined;
            ctx.body = {
                success: true,
                data: {
                    username: tokenInfo?.metadata?.username ?? expectedUsername,
                    expiresAt: tokenInfo?.expiresAt ?? null,
                },
            };
        });

        // WebSocket 日志监听（确保日志文件存在再 watch，避免 ENOENT）
        if (!existsSync(BaseApp.logFile)) {
            const dir = path.dirname(BaseApp.logFile);
            if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
            writeFileSync(BaseApp.logFile, "", "utf8");
        }
        const fileListener = (eventType: string) => {
            if (eventType === "change")
                this.ws.clients.forEach(async client => {
                    client.send(
                        JSON.stringify({
                            event: "system.log",
                            data: await readLine(1, BaseApp.logFile),
                        }),
                    );
                });
        };
        const logWatcher = fs.watch(BaseApp.logFile, fileListener);
        this.once("close", () => {
            logWatcher.close();
        });
        process.once("disconnect", () => {
            logWatcher.close();
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
                            schema: getAppConfigSchema(),
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


        // 管理端点
        this.router.get("/api/adapters", (ctx: RouterContext) => {
            ctx.body = [...this.adapters.values()].map(adapter => adapter.info);
        });

        this.router.get("/api/system", ctx => {
            ctx.body = this.info;
        });

        // CLI send：通过已运行网关发信
        this.router.post("/api/send", async (ctx: RouterContext) => {
            try {
                const body = (ctx.request.body as Record<string, unknown>) || {};
                const channel = String(body.channel ?? "");
                const target_id = String(body.target_id ?? "");
                const target_type = String(body.target_type ?? "private") as "private" | "group" | "channel";
                const message = String(body.message ?? "");
                if (!channel || !target_id) {
                    ctx.status = 400;
                    ctx.body = { success: false, message: "缺少 channel 或 target_id" };
                    return;
                }
                const parts = channel.split(".");
                const platform = parts[0];
                const account_id = parts.slice(1).join(".") || parts[1];
                if (!platform || !account_id) {
                    ctx.status = 400;
                    ctx.body = { success: false, message: "channel 格式应为 platform.account_id" };
                    return;
                }
                const adapter = this.adapters.get(platform as keyof import("@onebots/core").Adapter.Configs);
                if (!adapter) {
                    ctx.status = 404;
                    ctx.body = { success: false, message: `适配器 ${platform} 不存在` };
                    return;
                }
                const account = adapter.getAccount(account_id);
                if (!account) {
                    ctx.status = 404;
                    ctx.body = { success: false, message: `账号 ${channel} 不存在` };
                    return;
                }
                const segments = [{ type: "text", data: { text: message } }];
                const scene_id = adapter.createId(target_id);
                const result = await adapter.sendMessage(account_id, {
                    scene_type: target_type,
                    scene_id,
                    message: segments,
                });
                ctx.body = { success: true, message_id: result?.message_id ?? null };
            } catch (e: unknown) {
                const err = e as Error;
                ctx.status = 500;
                ctx.body = { success: false, message: err?.message ?? "发送失败" };
            }
        });

        // PTY 终端 WebSocket 端点
        const terminalWs = this.router.ws("/api/terminal");
        terminalWs.on("connection", (client, request) => {
            const token = getTokenFromRequest(request);
            if (!token || !this.tokenManager.validateToken(token).valid) {
                client.close(1008, "Unauthorized");
                return;
            }
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
                    } else if (payload.type === 'restart') {
                        // 通知所有客户端
                        this.terminalClients.forEach(c => {
                            try {
                                c.send(JSON.stringify({ type: 'output', data: '\r\n\x1b[33m[服务即将重启]\x1b[0m' }));
                            } catch (e) { }
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

        // 日志流 SSE 端点
        this.router.get("/api/logs", ctx => {
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
        this.router.get("/api/config", ctx => {
            ctx.body = fs.readFileSync(BaseApp.configPath, "utf8");
        });

        this.router.get("/api/config/schema", ctx => {
            ctx.body = getAppConfigSchema();
        });

        this.router.post("/api/config", (ctx: RouterContext) => {
            try {
                const configContent = ctx.request.body as string;
                fs.writeFileSync(BaseApp.configPath, configContent, "utf8");
                ctx.body = { success: true, message: "配置已保存" };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        // 账号管理端点
        this.router.get("/api/list", ctx => {
            ctx.body = this.accounts.map(bot => bot.info);
        });

        this.router.post("/api/add", (ctx: RouterContext) => {
            const config = ctx.request.body;
            try {
                this.addAccount(config);
                ctx.body = { success: true, message: '添加成功' };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        this.router.post("/api/edit", (ctx: RouterContext) => {
            const config = ctx.request.body;
            try {
                this.updateAccount(config);
                ctx.body = { success: true, message: '修改成功' };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        this.router.get("/api/remove", ctx => {
            const { uin, platform, force } = ctx.request.query;
            try {
                this.removeAccount(String(platform), String(uin), Boolean(force));
                ctx.body = { success: true, message: '移除成功' };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        this.router.post("/api/bots/start", async (ctx: RouterContext) => {
            const { platform, uin } = ctx.request.body as { platform: string; uin: string };
            try {
                const adapter = this.adapters.get(platform);
                await adapter?.setOnline(uin);
                ctx.body = { success: true, data: adapter?.getAccount(uin)?.info };
            } catch (e) {
                ctx.status = 500;
                ctx.body = { success: false, message: e.message };
            }
        });

        this.router.post("/api/bots/stop", async (ctx: RouterContext) => {
            const { platform, uin } = ctx.request.body as { platform: string; uin: string };
            try {
                const adapter = this.adapters.get(platform);
                await adapter?.setOffline(uin);
                ctx.body = { success: true, data: adapter?.getAccount(uin)?.info };
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
    async function safeImport(name: string) {
        try {
            return await import(name);
        } catch { }
    }
    export async function loadAdapterFactory(platform: string,maybeNames=[
        `@onebots/adapter-${platform}`,
        `onebots-adapter-${platform}`,
        platform
    ]):Promise<boolean>{
        if(!maybeNames.length) return false;
        const modName=maybeNames.shift()!;
        try{
            require(modName);
            return true;
        }catch (e) {
            console.warn(`[onebots] Failed to load adapter ${modName}: ${e}`);
            return loadAdapterFactory(platform,maybeNames);
        }
    }
    export async function loadProtocolFactory(name: string, maybeNames=[
        `@onebots/protocol-${name}`,
        `onebots-protocol-${name}`,
        `${name}`
        ]):Promise<boolean>{
        if(!maybeNames.length) return false;
        const modName=maybeNames.shift()!;
        try{
            require(modName);
            return true;
        }catch (e) {
            console.warn(`[onebots] Failed to load protocol ${modName}: ${e}`);
            return loadProtocolFactory(name,maybeNames);
        }
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
        copyFileSync(path.resolve(import.meta.dirname, "./config.sample.yaml"), BaseApp.configPath);
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
                filename: BaseApp.logFile,
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