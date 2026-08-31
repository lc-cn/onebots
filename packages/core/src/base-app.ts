import Koa from "koa";
import * as os from "os";
import "reflect-metadata";
import log4js from "log4js";
import type { Logger } from "log4js";
import { createServer, Server } from "http";
import yaml from "js-yaml";
import KoaBody from "koa-body";
import koaStatic from "koa-static";
const { configure, connectLogger, getLogger } = log4js;
import { deepClone, deepMerge } from "./utils.js";
import { Router } from "./router.js";
import { LogLevel } from "./types.js";
import * as path from "path";
import { Adapter } from "./adapter.js";
import { Protocol } from "./protocol.js";
import process from "process";
import { Account } from "./account.js";
import { SqliteDB } from "./db.js";
import pkg from "../package.json" with { type: "json" };
import { AdapterRegistry } from "./registry.js";
import { ConfigValidator, BaseAppConfigSchema } from "./config-validator.js";
import { LifecycleManager } from "./lifecycle.js";
import { ErrorHandler, ConfigError, ResourceError } from "./errors.js";
import { Logger as EnhancedLogger, createLogger } from "./logger.js";
import {
    initSecurityAudit,
    securityAudit,
    closeSecurityAudit,
} from "./middleware/security-audit.js";
import { defaultRateLimit } from "./middleware/rate-limit.js";
import { metricsCollector } from "./middleware/metrics-collector.js";
import { registerObservabilityEndpoints } from "./app-observability.js";
import { resolvePublicStaticRoot } from "./public-static-root.js";
import { assertHostConfigReloadable, resolveListenPort } from "./app-reload.js";
import { writeConfigFileAtomic } from "./config-file.js";
export { configure, yaml, connectLogger };
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
    /** 热重载期间保持 HTTP 存活，但 readiness 必须拒绝流量。 */
    isReloading: boolean = false;
    isDisposed: boolean = false;
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
    db: SqliteDB;
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
            this.config = ConfigValidator.validateWithDefaults(
                mergedConfig as Partial<Required<BaseApp.Config>>,
                BaseAppConfigSchema,
            );
        } catch (error) {
            const configError = ErrorHandler.wrap(error, { config: mergedConfig });
            throw new ConfigError("Configuration validation failed", {
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
        this.lifecycle.register("database", () => this.db.close());

        // 创建 HTTP 服务器
        this.httpServer = createServer(this.callback());
        this.router = new Router(this.httpServer);

        // 注册路由清理
        this.lifecycle.register("router", () => {
            return this.router.cleanupAsync();
        });

        // 注册 HTTP 服务器清理
        this.lifecycle.register("httpServer", () => {
            return new Promise<void>(resolve => {
                this.httpServer.close(() => resolve());
            });
        });

        // 初始化安全审计日志
        initSecurityAudit(path.join(BaseApp.dataDir, "audit"));

        // 注册健康检查端点（无需认证）
        registerObservabilityEndpoints(this, pkg.version);

        // 用户配置的站点根静态目录（需在 Router 等功能路由之前，便于 GET /xxx.txt 等直出）
        const publicStaticDir = this.getPublicStaticRoot();
        if (publicStaticDir) {
            this.enhancedLogger.info("已启用站点根静态目录", { dir: publicStaticDir });
            this.use(koaStatic(publicStaticDir));
        }

        // 中间件链（multipart：管理端上传站点静态文件等）
        this.use(
            KoaBody({
                multipart: true,
                // Webhook（如 Slack）必须使用未经解析的字节串验证签名。
                includeUnparsed: true,
                formidable: {
                    maxFileSize: 2 * 1024 * 1024,
                    keepExtensions: true,
                },
            }),
        )
            // 性能指标收集（最早执行，以便记录所有请求）
            .use(metricsCollector())
            // 安全审计日志
            .use(securityAudit())
            // 速率限制（在认证之前，防止暴力破解）
            .use(defaultRateLimit)
            .use(async (_ctx, next) => {
                // 本层不做鉴权。管理端鉴权仅针对 /api（由 onebots 应用层负责）；各平台对外 API（如 /{platform}/{accountId}/onebot/v11/...）由各自协议/适配器单独鉴权。
                return next();
            })
            .use(this.router.routes())
            .use(this.router.allowedMethods());

        this.enhancedLogger.info("Application initialized", {
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

    /** 管理端 API：当前解析后的站点根静态目录。 */
    getPublicStaticRoot(): string | null {
        return resolvePublicStaticRoot(
            BaseApp.configDir,
            this.config.public_static_dir,
            this.enhancedLogger,
        );
    }
    get adapterConfigs(): Map<string, Account.Config[]> {
        const map = new Map<string, Account.Config[]>();
        Object.keys(this.config).forEach(key => {
            const [platform, ...accountId] = key.split(".");
            const account_id = accountId.join(".");
            if (!account_id) return;
            if (!AdapterRegistry.has(platform)) {
                this.logger.warn(`未找到对应的适配器：${platform}`);
                return;
            }
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
            }
        }
    }

    public async addAccount<P extends keyof Adapter.Configs>(config: Account.Config<P>) {
        this.config[`${config.platform}.${config.account_id}`] = config;
        const adapter = this.findOrCreateAdapter<P>(config.platform);
        if (!adapter) return;
        const account = adapter.createAccount(config);
        adapter.accounts.set(config.account_id, account);
        if (this.isStarted) await account.start();
        const content = yaml.dump(deepClone(this.config));
        writeConfigFileAtomic(BaseApp.configPath, content, {
            backup: true,
        });
        this.onConfigPersisted(BaseApp.configPath, content);
    }

    public async updateAccount<P extends keyof Adapter.Configs>(config: Adapter.Configs[P]) {
        const adapter = this.findOrCreateAdapter(config.platform);
        if (!adapter) return;
        const account = adapter.accounts.get(config.account_id);
        if (!account) return this.addAccount(config);
        const newConfig = deepMerge(this.config[`${config.platform}.${config.account_id}`], config);
        await this.removeAccount(config.platform, config.account_id);
        await this.addAccount(newConfig);
    }

    public async removeAccount(p: string, uin: string, force?: boolean) {
        const adapter = this.findOrCreateAdapter(p);
        if (!adapter) return;
        const account = adapter.accounts.get(uin);
        if (!account) return this.logger.warn(`未找到账号${uin}`);
        await account.stop(force);
        delete this.config[`${p}.${uin}`];
        adapter.accounts.delete(uin);
        const content = yaml.dump(this.config);
        writeConfigFileAtomic(BaseApp.configPath, content, { backup: true });
        this.onConfigPersisted(BaseApp.configPath, content);
    }

    /** 配置由核心账号操作成功落盘后的扩展钩子。 */
    protected onConfigPersisted(_configPath: string, _content: string): void {}

    get accounts() {
        return [...this.adapters.values()]
            .map(adapter => {
                return [...adapter.accounts.values()];
            })
            .flat();
    }
    public findOrCreateAdapter<P extends keyof Adapter.Configs>(platform: P) {
        if (this.adapters.has(platform)) return this.adapters.get(platform);
        const adapter = AdapterRegistry.create(`${platform}`, this);
        this.adapters.set(platform, adapter);
        this.onAdapterCreated(adapter);
        return adapter;
    }

    /**
     * 适配器首次创建后的钩子，子类可覆写以订阅该适配器事件（如 verification:request）
     */
    protected onAdapterCreated(_adapter: Adapter): void {}

    protected assertCanStart(): void {
        if (this.isDisposed) {
            throw new ResourceError("应用资源已释放，不能再次启动；请创建新的 App 实例");
        }
    }

    private async startAdapters(): Promise<void> {
        for (const [platform, adapter] of this.adapters) {
            try {
                await adapter.start();
            } catch (error) {
                const wrappedError = ErrorHandler.wrap(error, { platform });
                this.enhancedLogger.error(wrappedError, { platform });
            }
        }
    }

    private async stopAdapters(): Promise<void> {
        await Promise.all(
            [...this.adapters].map(async ([platform, adapter]) => {
                try {
                    await adapter.stop();
                } catch (error) {
                    const wrappedError = ErrorHandler.wrap(error, { platform });
                    this.enhancedLogger.error(wrappedError, { platform });
                }
            }),
        );
    }

    async start() {
        this.assertCanStart();
        if (this.isStarted) return;
        const stopTimer = this.enhancedLogger.start("Application start");

        try {
            // 执行启动钩子
            await this.lifecycle.start();

            // 启动 HTTP 服务器
            await new Promise<void>((resolve, reject) => {
                this.httpServer.once("error", reject);
                this.httpServer.listen(
                    resolveListenPort(this.config.port, process.env.PORT),
                    () => {
                        this.httpServer.removeListener("error", reject);
                        resolve();
                    },
                );
            });

            const address = this.httpServer.address();
            const listeningPort =
                address && typeof address === "object" ? address.port : this.config.port;
            this.enhancedLogger.mark(
                `Server listening at http://0.0.0.0:${listeningPort}/${
                    this.config.path ? this.config.path : ""
                }`,
                { port: listeningPort, path: this.config.path },
            );

            await this.startAdapters();

            this.isStarted = true;
            stopTimer();
        } catch (error) {
            const wrappedError = ErrorHandler.wrap(error);
            this.enhancedLogger.fatal(wrappedError);
            throw wrappedError;
        }
    }
    async reload(config: BaseApp.Config) {
        if (this.isReloading) {
            throw new ConfigError("OneBots 配置正在重载，请等待当前操作完成");
        }
        const merged = deepMerge(deepClone(BaseApp.defaultConfig), config);
        const next = ConfigValidator.validateWithDefaults(
            merged as Partial<Required<BaseApp.Config>>,
            BaseAppConfigSchema,
        );
        assertHostConfigReloadable(this.config, next);

        const previous = this.config;
        const wasStarted = this.isStarted;
        this.isReloading = true;

        try {
            await this.stopAdapters();
            this.adapters.clear();
            this.config = next;
            this.logger.level = next.log_level;
            this.enhancedLogger.setLevel(next.log_level);
            this.initAdapters();
            if (wasStarted) await this.startAdapters();
        } catch (error) {
            await this.stopAdapters();
            this.adapters.clear();
            this.config = previous;
            this.logger.level = previous.log_level;
            this.enhancedLogger.setLevel(previous.log_level);
            this.initAdapters();
            if (wasStarted) await this.startAdapters();
            throw ErrorHandler.wrap(error, { operation: "reload" });
        } finally {
            this.isReloading = false;
        }
    }
    async stop() {
        if (this.isDisposed) return;
        const stopTimer = this.enhancedLogger.start("Application stop");

        try {
            // 执行停止钩子
            await this.lifecycle.stop();

            await this.stopAdapters();
            this.adapters.clear();

            // 清理资源
            await this.lifecycle.cleanup();

            // 关闭安全审计日志
            closeSecurityAudit();

            this.emit("close");
            this.isStarted = false;
            this.isDisposed = true;
            stopTimer();

            this.enhancedLogger.info("Application stopped");
        } catch (error) {
            const wrappedError = ErrorHandler.wrap(error);
            this.enhancedLogger.error(wrappedError);
            throw wrappedError;
        }
    }
}

export namespace BaseApp {
    export type AdapterConfig = {
        [P in keyof Adapter.Configs as `${P}.${string}`]?: Adapter.Configs[P] &
            Partial<Protocol.Configs>;
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
        /** 站点根静态目录，相对配置文件所在目录（configDir）或绝对路径；用于企业微信等可信域名校验文件 */
        public_static_dir?: string;
        general?: Protocol.Configs;
    } & KoaOptions &
        AdapterConfig;
    export const defaultConfig: Config = {
        port: 6727,
        database: "onebots.db",
        timeout: 30,
        general: {},
        log_level: "info",
    };

    export let configDir = path.join(os.homedir(), ".onebots");
}
