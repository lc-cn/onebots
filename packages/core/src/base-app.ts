import Koa from "koa";
import * as os from "os";
import "reflect-metadata";
import * as fs from "fs";
import { writeFileSync } from "fs";
import log4js from "log4js";
import type { Logger } from "log4js";
import { createServer, Server } from "http";
import yaml from "js-yaml";
import KoaBodyParser from "koa-bodyparser";
import basicAuth from "koa-basic-auth";
const { configure,connectLogger,getLogger } = log4js;
import { Class, deepClone, deepMerge, readLine } from "@/utils.js";
import { Router, WsServer } from "./router.js";
import { LogLevel } from "@/types.js";
import * as path from "path";
import { Adapter } from "@/adapter.js";
import { Protocol } from "@/protocol.js";
import process from "process";
import { Dict } from "./types.js";
import { Account } from "@/account.js";
import { SqliteDB } from "@/db.js";
import { AdapterRegistry } from "./registry.js";
export {
    configure,
    yaml,
    connectLogger
}
export interface KoaOptions {
    env?: string;
    keys?: string[];
    proxy?: boolean;
    subdomainOffset?: number;
    proxyIpHeader?: string;
    maxIpsCount?: number;
}

type AdapterClass = Class<Adapter>;

export class BaseApp extends Koa {
    public config: Required<BaseApp.Config>;
    public httpServer: Server;
    isStarted: boolean = false;
    public logger: Logger;
    static get configPath() {
        return path.join(BaseApp.configDir, "config.yaml");
    }
    static get dataDir() {
        return path.join(BaseApp.configDir, "data");
    }
    static get logFile() {
        return path.join(BaseApp.configDir, "onebots.log");
    }
    db:SqliteDB
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
    constructor(config: BaseApp.Config = {}) {
        super(config);
        
        this.config = deepMerge(deepClone(BaseApp.defaultConfig), config);
        this.init();
    }

    init() {
        this.logger = getLogger("[OneBots]");
        this.db=new SqliteDB(path.resolve(BaseApp.dataDir, this.config.database));
        this.logger.level = this.config.log_level;
        this.httpServer = createServer(this.callback());
        this.router = new Router(this.httpServer, { prefix: this.config.path });
        this.use(KoaBodyParser({}))
            .use(this.router.routes())
            .use(this.router.allowedMethods())
            .use(async (ctx, next) => {
                const adapter = ctx.path?.slice(1)?.split("/")[0];
                if (this.adapters.has(adapter)) return next();
                return basicAuth({
                    name: this.config.username,
                    pass: this.config.password,
                })(ctx, next);
            });
        this.ws = this.router.ws("/");

        this.initAdapters();
    }
    getLogger(patform: string) {
        const logger = getLogger(`[OneBots:${patform}]`);
        logger.level = this.config.log_level;
        return logger;
    }

    get adapterConfigs():Map<string,Account.Config[]> {
        const map=new Map<string,Account.Config[]>();
        Object.keys(this.config).forEach(key=>{
            const [platform, ...accountId]=key.split(".");
            const account_id=accountId.join(".");
            if(!account_id) return;
            if(!AdapterRegistry.has(platform)) return console.warn(`未找到对应的适配器：${platform}`);
            if(!map.has(platform)) map.set(platform,[]);
            const accountList=map.get(platform);
            accountList.push({
                ...this.config[key],
                platform,
                account_id
            });
        });
        return map;
    }

    private initAdapters() {
        for (const [platform, accountList] of this.adapterConfigs) {
            const adapter= this.findOrCreateAdapter(platform);
            if(!adapter) continue;
            for(const accountConfig of accountList){
                const account=adapter.createAccount(accountConfig);
                adapter.accounts.set(accountConfig.account_id, account);
                if(this.isStarted) account.start();
            }
        }
    }

    public addAccount<P extends keyof Adapter.Configs>(config:Account.Config<P>) {
        this.config[`${config.platform}.${config.account_id}`] = config;
        const adapter = this.findOrCreateAdapter<P>(config.platform);
        if (!adapter) return;
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        if(this.isStarted) account.start();
        writeFileSync(BaseApp.configPath, yaml.dump(deepClone(this.config)));
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
        writeFileSync(BaseApp.configPath, yaml.dump(this.config));
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
        const adapter = AdapterRegistry.create(`${platform}`,this);
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
        this.ws.on("connection", async client => {
            client.send(
                JSON.stringify({
                    event: "system.sync",
                    data: {
                        config: fs.readFileSync(BaseApp.configPath, "utf8"),
                        adapters: [...this.adapters.values()].map(adapter => {
                            return adapter.info;
                        }),
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
    async reload(config: BaseApp.Config) {
        await this.stop();
        this.config = deepMerge(deepClone(BaseApp.defaultConfig), config);
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


export namespace BaseApp {
    export type AdapterConfig = {
        [P in keyof Adapter.Configs as `${P}.${string}`]?: Adapter.Configs[P] & Partial<Protocol.Configs>;
    };
    export type Config = {
        port?: number;
        path?: string;
        database?: string;
        timeout?: number;
        username?: string;
        password?: string;
        log_level?: LogLevel;
        general?: Protocol.Configs;
    } & KoaOptions & AdapterConfig;
    export const defaultConfig: Config = {
        port: 6727,
        database: "onebots.db",
        username: "admin",
        password: "123456",
        timeout: 30,
        general: {},
        log_level: "info",
    };

    export let configDir = path.join(os.homedir(), ".onebots");
}
