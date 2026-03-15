import Koa from "koa";
import * as os from "os";
import "reflect-metadata";
import * as fs from "fs";
import { writeFileSync } from "fs";
import log4js from "log4js";
import type { Logger } from "log4js";
import { createServer, Server } from "http";
import yaml from "js-yaml";
import KoaBody from "koa-body";
import basicAuth from "koa-basic-auth";
const { configure,connectLogger,getLogger } = log4js;
import { Class, deepClone, deepMerge, readLine } from "@/utils.js";
import { Router, WsServer } from "./router.js";
import { LogLevel } from "@/types.js";
import * as path from "path";
import { Adapter } from "@/adapter.js";
import { Protocol } from "@/protocol.js";
import process from "process";
import { Account } from "@/account.js";
import { SqliteDB } from "@/db.js";
import pkg from "../package.json" with { type: "json" };
import { AdapterRegistry,ProtocolRegistry } from "./registry.js";
import { ConfigValidator, BaseAppConfigSchema } from "./config-validator.js";
import { LifecycleManager } from "./lifecycle.js";
import { ErrorHandler, ConfigError } from "./errors.js";
import { Logger as EnhancedLogger, createLogger } from "./logger.js";
import { initSecurityAudit, securityAudit, closeSecurityAudit } from "./middleware/security-audit.js";
import { defaultRateLimit } from "./middleware/rate-limit.js";
import { metricsCollector } from "./middleware/metrics-collector.js";
import { metrics } from "./metrics.js";
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


export class BaseApp extends Koa {
    public config: Required<BaseApp.Config>;
    public httpServer: Server;
    isStarted: boolean = false;
    public logger: Logger;
    public enhancedLogger: EnhancedLogger;
    public lifecycle: LifecycleManager;
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
    public router: Router;
    get info() {
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
        
        // 初始化生命周期管理器
        this.lifecycle = new LifecycleManager();
        
        // 合并配置并验证
        const mergedConfig = deepMerge(deepClone(BaseApp.defaultConfig), config);
        try {
            this.config = ConfigValidator.validateWithDefaults(mergedConfig, BaseAppConfigSchema);
        } catch (error) {
            const configError = ErrorHandler.wrap(error, { config: mergedConfig });
            throw new ConfigError('Configuration validation failed', {
                context: { originalError: configError.toJSON() },
                cause: configError,
            });
        }
        
        this.init();
    }

    init() {
        // 初始化传统日志（保持兼容性）
        this.logger = getLogger("[onebots]");
        this.logger.level = this.config.log_level;
        
        // 初始化增强日志
        this.enhancedLogger = createLogger("[onebots]", this.config.log_level);
        
        // 注册数据库资源到生命周期管理器
        this.db = new SqliteDB(path.resolve(BaseApp.dataDir, this.config.database));
        this.lifecycle.register('database', () => {
            // 数据库清理逻辑（如果需要）
        });
        
        // 创建 HTTP 服务器
        this.httpServer = createServer(this.callback());
        this.router = new Router(this.httpServer);
        
        // 注册路由清理
        this.lifecycle.register('router', () => {
            return this.router.cleanupAsync();
        });
        
        // 注册 HTTP 服务器清理
        this.lifecycle.register('httpServer', () => {
            return new Promise<void>((resolve) => {
                this.httpServer.close(() => resolve());
            });
        });
        
        // 初始化安全审计日志
        initSecurityAudit(path.join(BaseApp.dataDir, 'audit'));
        
        // 注册健康检查端点（无需认证）
        this.setupHealthEndpoints();
        
        // 中间件链
        this.use(KoaBody())
            // 性能指标收集（最早执行，以便记录所有请求）
            .use(metricsCollector())
            // 安全审计日志
            .use(securityAudit())
            // 速率限制（在认证之前，防止暴力破解）
            .use(defaultRateLimit)
            .use(async (ctx, next) => {
                // 健康检查端点跳过认证
                if (ctx.path === '/health' || ctx.path === '/ready' || ctx.path === '/metrics') {
                    return next();
                }
                // 管理端点由应用层 Token 鉴权处理
                if (ctx.path.startsWith('/api')) {
                    return next();
                }
                // 检查是否是协议路径格式: /{platform}/{accountId}/{protocol}/{version}/...
                const pathParts = ctx.path?.split("/").filter(p => p) || [];
                
                const [_platform, _accountId, protocol, version] = pathParts;
                if (ProtocolRegistry.has(protocol, version)) {
                    return next();
                }
                return await basicAuth({
                    name: this.config.username,
                    pass: this.config.password,
                })(ctx, next)
            })
            .use(this.router.routes())
            .use(this.router.allowedMethods());
        
        this.enhancedLogger.info('Application initialized', {
            username: this.config.username,
            port: this.config.port,
        });
        
        this.initAdapters();
    }
    getLogger(patform: string) {
        const logger = getLogger(`[onebots:${patform}]`);
        logger.level = this.config.log_level;
        return logger;
    }
    
    /**
     * 获取增强的 Logger 实例
     */
    getEnhancedLogger(name: string): EnhancedLogger {
        return createLogger(`[onebots:${name}]`, this.config.log_level);
    }

    /**
     * 设置健康检查端点
     */
    private setupHealthEndpoints() {
        // /health - 基础健康检查（存活探针）
        this.router.get('/health', (ctx) => {
            ctx.body = {
                status: 'ok',
                timestamp: new Date().toISOString(),
                uptime: process.uptime(),
                version: pkg.version,
            };
        });

        // /ready - 就绪检查（就绪探针）
        this.router.get('/ready', (ctx) => {
            const adaptersStatus: Record<string, { online: number; offline: number; total: number }> = {};
            let allReady = true;
            let totalOnline = 0;
            let totalAccounts = 0;

            for (const [platform, adapter] of this.adapters) {
                let online = 0;
                let offline = 0;
                for (const account of adapter.accounts.values()) {
                    totalAccounts++;
                    if (account.status === 'online') {
                        online++;
                        totalOnline++;
                    } else {
                        offline++;
                    }
                }
                adaptersStatus[platform] = { online, offline, total: online + offline };
                if (offline > 0) allReady = false;
            }

            ctx.status = allReady && this.isStarted ? 200 : 503;
            ctx.body = {
                ready: allReady && this.isStarted,
                timestamp: new Date().toISOString(),
                server: this.isStarted,
                adapters: adaptersStatus,
                summary: {
                    total_adapters: this.adapters.size,
                    total_accounts: totalAccounts,
                    online_accounts: totalOnline,
                },
            };
        });

        // /metrics - Prometheus 格式指标
        this.router.get('/metrics', (ctx) => {
            const metricLines: string[] = [];

            // 基础指标
            metricLines.push(`# HELP onebots_info OneBots application info`);
            metricLines.push(`# TYPE onebots_info gauge`);
            metricLines.push(`onebots_info{version="${pkg.version}"} 1`);

            metricLines.push(`# HELP onebots_uptime_seconds Application uptime in seconds`);
            metricLines.push(`# TYPE onebots_uptime_seconds gauge`);
            metricLines.push(`onebots_uptime_seconds ${process.uptime()}`);

            metricLines.push(`# HELP onebots_started Whether the application is started`);
            metricLines.push(`# TYPE onebots_started gauge`);
            metricLines.push(`onebots_started ${this.isStarted ? 1 : 0}`);

            // 内存使用
            const memUsage = process.memoryUsage();
            metricLines.push(`# HELP onebots_memory_bytes Memory usage in bytes`);
            metricLines.push(`# TYPE onebots_memory_bytes gauge`);
            metricLines.push(`onebots_memory_bytes{type="rss"} ${memUsage.rss}`);
            metricLines.push(`onebots_memory_bytes{type="heapTotal"} ${memUsage.heapTotal}`);
            metricLines.push(`onebots_memory_bytes{type="heapUsed"} ${memUsage.heapUsed}`);
            metricLines.push(`onebots_memory_bytes{type="external"} ${memUsage.external}`);

            // 适配器和账号指标
            metricLines.push(`# HELP onebots_adapters_total Total number of adapters`);
            metricLines.push(`# TYPE onebots_adapters_total gauge`);
            metricLines.push(`onebots_adapters_total ${this.adapters.size}`);

            metricLines.push(`# HELP onebots_accounts_total Total accounts by platform and status`);
            metricLines.push(`# TYPE onebots_accounts_total gauge`);
            
            for (const [platform, adapter] of this.adapters) {
                let online = 0;
                let offline = 0;
                for (const account of adapter.accounts.values()) {
                    if (account.status === 'online') online++;
                    else offline++;
                }
                metricLines.push(`onebots_accounts_total{platform="${platform}",status="online"} ${online}`);
                metricLines.push(`onebots_accounts_total{platform="${platform}",status="offline"} ${offline}`);
            }

            // 添加性能指标
            const prometheusMetrics = metrics.exportPrometheus();
            if (prometheusMetrics.trim()) {
                metricLines.push('\n# Performance metrics');
                metricLines.push(prometheusMetrics);
            }

            ctx.type = 'text/plain; charset=utf-8';
            ctx.body = metricLines.join('\n') + '\n';
        });
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
        const stopTimer = this.enhancedLogger.start('Application start');
        
        try {
            // 执行启动钩子
            await this.lifecycle.start();
            
            // 启动 HTTP 服务器
            await new Promise<void>((resolve, reject) => {
                this.httpServer.once('error', reject);
                this.httpServer.listen(this.config.port, () => {
                    this.httpServer.removeListener('error', reject);
                    resolve();
                });
            });
            
            this.enhancedLogger.mark(
                `Server listening at http://0.0.0.0:${this.config.port}/${
                    this.config.path ? this.config.path : ""
                }`,
                { port: this.config.port, path: this.config.path },
            );
            
            // 启动所有适配器
            for (const [platform, adapter] of this.adapters) {
                try {
                    await adapter.start();
                    this.enhancedLogger.info(`Adapter started`, { platform });
                } catch (error) {
                    const wrappedError = ErrorHandler.wrap(error, { platform });
                    this.enhancedLogger.error(wrappedError, { platform });
                    // 继续启动其他适配器
                }
            }
            
            this.isStarted = true;
            stopTimer();
        } catch (error) {
            const wrappedError = ErrorHandler.wrap(error);
            this.enhancedLogger.fatal(wrappedError);
            throw wrappedError;
        }
    }
    async reload(config: BaseApp.Config) {
        await this.stop();
        this.config = deepMerge(deepClone(BaseApp.defaultConfig), config);
        this.initAdapters();
        await this.start();
    }
    async stop() {
        const stopTimer = this.enhancedLogger.start('Application stop');
        
        try {
            // 执行停止钩子
            await this.lifecycle.stop();
            
            // 停止所有适配器
            const stopPromises: Promise<void>[] = [];
            for (const [platform, adapter] of this.adapters) {
                stopPromises.push(
                    Promise.resolve(adapter.stop()).catch(error => {
                        const wrappedError = ErrorHandler.wrap(error, { platform });
                        this.enhancedLogger.error(wrappedError, { platform });
                    }),
                );
            }
            await Promise.all(stopPromises);
            this.adapters.clear();
            
            // 清理资源
            await this.lifecycle.cleanup();
            
            // 关闭安全审计日志
            closeSecurityAudit();
            
            this.emit("close");
            this.isStarted = false;
            stopTimer();
            
            this.enhancedLogger.info('Application stopped');
        } catch (error) {
            const wrappedError = ErrorHandler.wrap(error);
            this.enhancedLogger.error(wrappedError);
            throw wrappedError;
        }
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
        /** 管理端 Bearer 鉴权码，配置后可使用 Authorization: Bearer <access_token> 访问 API，无需用户名密码 */
        access_token?: string;
        log_level?: LogLevel;
        general?: Protocol.Configs;
    } & KoaOptions & AdapterConfig;
    export const defaultConfig: Config = {
        port: 6727,
        database: "onebots.db",
        timeout: 30,
        general: {},
        log_level: "info",
    };

    export let configDir = path.join(os.homedir(), ".onebots");
}
