import Koa from "koa";
import * as os from "os";
import "reflect-metadata";
import * as fs from "fs";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { configure, getLogger, Logger } from "log4js";
import { createServer, Server } from "http";
import koaStatic from "koa-static";
import yaml from "js-yaml";
import KoaBodyParser from "koa-bodyparser";
import basicAuth from "koa-basic-auth";

import { Class, deepClone, deepMerge, readLine } from "@/utils";
import { Router, WsServer } from "./router";
import { LogLevel } from "@/types";
import * as path from "path";
import { Adapter } from "@/adapter";
import { Protocol } from "@/protocols/base";
import { ChildProcess } from "child_process";
import process from "process";
import { Dict } from "@zhinjs/shared";
import { Account } from "@/account";

export interface KoaOptions {
    env?: string;
    keys?: string[];
    proxy?: boolean;
    subdomainOffset?: number;
    proxyIpHeader?: string;
    maxIpsCount?: number;
}

type AdapterClass = Class<Adapter>;

export class App extends Koa {
    public config: Required<App.Config>;
    public httpServer: Server;
    isStarted: boolean = false;
    public logger: Logger;
    static configDir = path.join(os.homedir(), ".onebots");
    static get configPath() {
        return path.join(App.configDir, "config.yaml");
    }
    static get dataDir() {
        return path.join(App.configDir, "data");
    }
    static get logFile() {
        return path.join(App.configDir, "onebots.log");
    }
    adapters: Map<keyof Adapter.Configs, Adapter> = new Map<keyof Adapter.Configs, Adapter>();
    public ws: WsServer;
    public router: Router;
    get info() {
        const pkg = require(path.resolve(__dirname, "../../package.json"));
        const free_memory = os.freemem();
        const total_memory = os.totalmem();
        return {
            system_platform: process.platform,
            system_arch: process.arch,
            system_cpus: os.cpus(),
            system_version: os.version(),
            system_uptime: os.uptime() * 1000,
            username: os.userInfo().username,
            total_memory,
            free_memory,
            process_id: process.pid,
            process_parent_id: process.ppid,
            process_cwd: process.cwd(),
            process_use_memory: process.memoryUsage.rss(),
            node_version: process.version,
            sdk_version: pkg.version,
            uptime: process.uptime() * 1000,
        };
    }
    constructor(config: App.Config = {}) {
        super(config);

        this.config = deepMerge(deepClone(App.defaultConfig), config);
        this.init();
    }

    init() {
        this.logger = getLogger("[OneBots]");
        this.logger.level = this.config.log_level;
        this.httpServer = createServer(this.callback());
        this.router = new Router(this.httpServer, { prefix: this.config.path });
        this.use(KoaBodyParser())
            .use(this.router.routes())
            .use(this.router.allowedMethods())
            .use(async (ctx, next) => {
                const adapter = ctx.path?.slice(1)?.split("/")[0];
                if (this.adapters.has(adapter)) return next();
                return basicAuth({
                    name: this.config.username,
                    pass: this.config.password,
                })(ctx, next);
            })
            .use(koaStatic(path.resolve(__dirname, "../../dist")));
        this.ws = this.router.ws("/");

        this.initAdapters();
    }
    getLogger(patform: string) {
        const logger = getLogger(`[OneBots:${patform}]`);
        logger.level = this.config.log_level;
        return logger;
    }

    get adapterConfigs(): Map<string, Account.Config[]> {
        const map = new Map<string, Account.Config[]>();
        Object.keys(this.config).forEach(key => {
            const [platform, ...accountId] = key.split(".");
            const account_id = accountId.join(".");
            if (!account_id) return;
            if (!App.ADAPTERS.has(platform)) return console.warn(`未找到对应的适配器：${platform}`);
            if (!map.has(platform)) map.set(platform, []);
            const accountList = map.get(platform);
            accountList.push({
                ...this.config[key],
                platform,
                account_id,
            });
        });
        return map;
    }

    private initAdapters() {
        for (const [platform, accountList] of this.adapterConfigs) {
            const adapter = this.findOrCreateAdapter(platform);
            if (!adapter) continue;
            for (const accountConfig of accountList) {
                const account = adapter.createAccount(accountConfig);
                adapter.accounts.set(accountConfig.account_id, account);
                if (this.isStarted) account.start();
            }
        }
    }

    public addAccount<P extends keyof Adapter.Configs>(config: Account.Config<P>) {
        this.config[`${config.platform}.${config.account_id}`] = config;
        const adapter = this.findOrCreateAdapter<P>(config.platform);
        if (!adapter) return;
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        if (this.isStarted) account.start();
        writeFileSync(App.configPath, yaml.dump(deepClone(this.config)));
    }

    public updateAccount<P extends keyof Adapter.Configs>(config: Adapter.Configs[P]) {
        const adapter = this.findOrCreateAdapter(config.platform);
        if (!adapter) return;
        const account = adapter.accounts.get(config.account_id);
        if (!account) return this.addAccount(config);
        const newConfig = deepMerge(this.config[`${config.platform}.${config.account_id}`], config);
        this.removeAccount(config.platform, config.account_id);
        this.addAccount(newConfig);
    }

    public removeAccount(p: string, uin: string, force?: boolean) {
        const adapter = this.findOrCreateAdapter(p);
        if (!adapter) return;
        const account = adapter.accounts.get(uin);
        if (!account) return this.logger.warn(`未找到账号${uin}`);
        account.stop(force);
        delete this.config[`${p}.${uin}`];
        adapter.accounts.delete(uin);
        writeFileSync(App.configPath, yaml.dump(this.config));
    }

    get accounts() {
        return [...this.adapters.values()]
            .map(adapter => {
                return [...adapter.accounts.values()];
            })
            .flat();
    }
    public findOrCreateAdapter<P extends keyof Adapter.Configs>(platform: P) {
        if (this.adapters.has(platform)) return this.adapters.get(platform);
        const AdapterClass = App.ADAPTERS.get(platform);
        if (!AdapterClass) return this.logger.warn(`未安装适配器(${platform})`);
        const adapter = new AdapterClass(this);
        this.adapters.set(platform, adapter);
        return adapter;
    }

    async start() {
        this.httpServer.listen(this.config.port);
        const fileListener = e => {
            if (e === "change")
                this.ws.clients.forEach(async client => {
                    client.send(
                        JSON.stringify({
                            event: "system.log",
                            data: await readLine(1, App.logFile),
                        }),
                    );
                });
        };
        fs.watch(App.logFile, fileListener);
        this.once("close", () => {
            fs.unwatchFile(App.logFile, fileListener);
        });
        process.once("disconnect", () => {
            fs.unwatchFile(App.logFile, fileListener);
        });
        this.ws.on("connection", async client => {
            client.send(
                JSON.stringify({
                    event: "system.sync",
                    data: {
                        config: fs.readFileSync(App.configPath, "utf8"),
                        adapters: [...this.adapters.values()].map(adapter => {
                            return adapter.info;
                        }),
                        app: this.info,
                        logs: fs.existsSync(App.logFile) ? await readLine(100, App.logFile) : "",
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
                        // 将流的模式切换到“流动模式”
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
                        return fs.writeFileSync(App.configPath, payload.data, "utf8");
                    case "system.reload":
                        const config = yaml.load(fs.readFileSync(App.configPath, "utf8"));
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
        this.router.get("/list", ctx => {
            ctx.body = this.accounts.map(bot => {
                return bot.info;
            });
        });
        this.router.post("/add", (ctx, next) => {
            const config = (ctx.request.body || {}) as any;
            try {
                this.addAccount(config);
                ctx.body = `添加成功`;
            } catch (e) {
                ctx.body = e.message;
            }
        });
        this.router.post("/edit", (ctx, next) => {
            const config = (ctx.request.body || {}) as any;
            try {
                this.updateAccount(config);
                ctx.body = `修改成功`;
            } catch (e) {
                ctx.body = e.message;
            }
        });
        this.router.get("/remove", (ctx, next) => {
            const { uin, platform, force } = ctx.request.query;
            try {
                this.removeAccount(String(platform), String(uin), Boolean(force));
                ctx.body = `移除成功`;
            } catch (e) {
                console.log(e);
                ctx.body = e.message;
            }
        });
        process.on("uncaughtException", e => {
            console.error("uncaughtException", e);
        });
        process.on("unhandledRejection", e => {
            console.error("unhandledRejection", e);
        });
        this.logger.mark(
            `server listen at http://0.0.0.0:${this.config.port}/${
                this.config.path ? this.config.path : ""
            }`,
        );
        for (const [_, adapter] of this.adapters) {
            await adapter.start();
        }
        this.isStarted = true;
    }
    async reload(config: App.Config) {
        await this.stop();
        this.config = deepMerge(deepClone(App.defaultConfig), config);
        this.initAdapters();
        await this.start();
    }
    async stop() {
        for (const [_, adapter] of this.adapters) {
            await adapter.stop();
        }
        this.adapters.clear();
        // this.ws.close()
        this.httpServer.close();
        this.emit("close");
        this.isStarted = false;
    }
}

export function createOnebots(
    config: App.Config | string = "config.yaml",
    cp: ChildProcess | null = null,
) {
    const isStartWithConfigFile = typeof config === "string";
    if (isStartWithConfigFile) {
        config = path.resolve(process.cwd(), config as string);
        App.configDir = path.dirname(config);
    }
    if (!existsSync(App.configDir)) mkdirSync(App.configDir);
    if (!existsSync(App.configPath) && isStartWithConfigFile) {
        copyFileSync(path.resolve(__dirname, "../config.sample.yaml"), App.configPath);
        console.log("未找到对应配置文件，已自动生成默认配置文件，请修改配置文件后重新启动");
        console.log(`配置文件在:  ${App.configPath}`);
        process.exit();
    }
    if (!isStartWithConfigFile) {
        writeFileSync(App.configPath, yaml.dump(config));
        console.log(`已自动保存配置到：${App.configPath}`);
    }
    if (!existsSync(App.dataDir)) {
        mkdirSync(App.dataDir);
        console.log("已为你创建数据存储目录", App.dataDir);
    }
    config = yaml.load(readFileSync(App.configPath, "utf8")) as App.Config;
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
                level: (config as App.Config).log_level || "info",
            },
        },
        disableClustering: true,
    });
    if (cp) process.on("disconnect", () => cp.kill());
    return new App(config as App.Config);
}

export function defineConfig(config: App.Config) {
    return config;
}

export namespace App {
    export const ADAPTERS: Map<keyof Adapter.Configs, AdapterClass> = new Map();
    export type AdapterConfig = {
        [P in keyof Adapter.Configs as `${P}.${string}`]?: Adapter.Configs[P] &
            Partial<Protocol.Configs>;
    };
    export type Config = {
        port?: number;
        path?: string;
        timeout?: number;
        username?: string;
        password?: string;
        log_level?: LogLevel;
        general?: Protocol.Configs;
    } & KoaOptions &
        AdapterConfig;
    export const defaultConfig: Config = {
        port: 6727,
        username: "admin",
        password: "123456",
        timeout: 30,
        general: {},
        log_level: "info",
    };

    export function registerAdapter(name: string): void;
    export function registerAdapter<T extends string>(platform: T, adapter: AdapterClass): void;
    export function registerAdapter<T extends string>(platform: T, adapter?: AdapterClass) {
        if (!adapter) adapter = App.loadAdapter(platform);
        if (ADAPTERS.has(platform)) {
            console.warn(`已存在对应的适配器：${platform}`);
            return this;
        }
        ADAPTERS.set(platform, adapter);
    }
    export function registerGeneral<K extends keyof Protocol.Configs>(
        name: K,
        config: Protocol.Configs[K],
    ) {
        defaultConfig.general[name] = config;
    }
    export function loadAdapter<T extends string>(platform: string) {
        const maybeNames = [
            path.join(__dirname, "../adapters", platform), // 内置的
            `@onebots/adapter-${platform}`, // 我写的
            `onebots-adapter-${platform}`, // 别人按照规范写的
            platform, // 别人写的
        ];
        type AdapterClass = Class<Adapter<T>>;
        let error: Error;
        let adapter: AdapterClass;
        for (const name of maybeNames) {
            try {
                adapter = require(name)?.default;
                if (adapter) break;
            } catch (e) {
                error = e;
            }
        }
        if (!adapter) throw error;
        return adapter;
    }
}
