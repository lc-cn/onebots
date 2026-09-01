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
import { resolveDatabaseFilePath, SqliteDB } from "./db.js";
import pkg from "../package.json" with { type: "json" };
import { AdapterRegistry } from "./registry.js";
import { ConfigValidator, BaseAppConfigSchema } from "./config-validator.js";
import { LifecycleManager } from "./lifecycle.js";
import { ErrorHandler, ConfigError, ResourceError, ValidationError } from "./errors.js";
import { Logger as EnhancedLogger, createLogger } from "./logger.js";
import {
    initSecurityAudit,
    securityAudit,
    closeSecurityAudit,
} from "./middleware/security-audit.js";
import { defaultRateLimit } from "./middleware/rate-limit.js";
import { metricsCollector } from "./middleware/metrics-collector.js";
import {
    getRuntimeProcessIdentity,
    registerObservabilityEndpoints,
    type ApplicationIdentity,
} from "./app-observability.js";
export type { ApplicationIdentity } from "./app-observability.js";
import { resolvePublicStaticRoot } from "./public-static-root.js";
import { assertHostConfigReloadable, resolveListenPort } from "./app-reload.js";
import { emitAllAwaited, FailureCollector } from "./async-utils.js";
import { rollbackFailedStart as rollbackStartup } from "./startup-rollback.js";
import { normalizeGatewayPathPrefix } from "./gateway-path.js";
import { AccountMutationConflictError, mutateAccountAtomically } from "./account-transaction.js";
import { assertAccountIdentifier, assertAccountIdentity } from "./account-config.js";
import { acquireRuntimeOperation, type RuntimeOperation } from "./runtime-operation.js";
import { createAccountWithRouteScope } from "./scoped-account.js";
export { configure, yaml, connectLogger };
export interface KoaOptions {
    env?: string;
    keys?: string[];
    proxy?: boolean;
    subdomainOffset?: number;
    proxyIpHeader?: string;
    maxIpsCount?: number;
}

function normalizeApplicationIdentity(
    identity: ApplicationIdentity,
): Readonly<ApplicationIdentity> {
    const name = typeof identity?.name === "string" ? identity.name.trim() : "";
    const version = typeof identity?.version === "string" ? identity.version.trim() : "";
    if (!name || !version) {
        throw new ValidationError("应用身份必须包含非空的 name 与 version");
    }
    return Object.freeze({ name, version });
}

export class BaseApp extends Koa {
    public config: Required<BaseApp.Config>;
    public httpServer: Server;
    isStarted: boolean = false;
    /** 独占运行态操作期间保持 HTTP 存活，但 readiness 必须拒绝流量。 */
    isReloading: boolean = false;
    /** 对外解释 isReloading 对应的具体运行态操作。 */
    runtimeOperation: RuntimeOperation = "idle";
    isDisposed: boolean = false;
    public logger: Logger;
    public enhancedLogger: EnhancedLogger;
    public lifecycle: LifecycleManager;
    static get configPath() {
        return path.join(BaseApp.configDir, BaseApp.configFileName);
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
    public readonly applicationIdentity: Readonly<ApplicationIdentity>;
    get info() {
        const runtimeIdentity = getRuntimeProcessIdentity();
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
            application_name: this.applicationIdentity.name,
            application_version: this.applicationIdentity.version,
            instance_id: runtimeIdentity.instanceId,
            started_at: runtimeIdentity.startedAt,
            core_version: pkg.version,
            /** @deprecated 使用 core_version。 */
            sdk_version: pkg.version,
            uptime: process.uptime() * 1000,
        };
    }
    constructor(
        config: BaseApp.Config = {},
        applicationIdentity: ApplicationIdentity = { name: pkg.name, version: pkg.version },
    ) {
        super(config);
        this.applicationIdentity = normalizeApplicationIdentity(applicationIdentity);

        this.lifecycle = new LifecycleManager();

        const mergedConfig = deepMerge(deepClone(BaseApp.defaultConfig), deepClone(config));
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
        this.db = new SqliteDB(resolveDatabaseFilePath(BaseApp.dataDir, this.config.database));
        this.lifecycle.register("database", () => this.db.close());

        // 创建 HTTP 服务器
        this.httpServer = createServer(this.callback());
        const gatewayPath = normalizeGatewayPathPrefix(this.config.path);
        this.router = new Router(
            this.httpServer,
            gatewayPath ? { prefix: gatewayPath } : undefined,
        );

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
        registerObservabilityEndpoints(this, {
            ...this.applicationIdentity,
            coreVersion: pkg.version,
        });

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
                const account = createAccountWithRouteScope(this, adapter, accountConfig);
                adapter.accounts.set(accountConfig.account_id, account);
            }
        }
    }

    public async addAccount<P extends keyof Adapter.Configs>(config: Account.Config<P>) {
        assertAccountIdentity(config);
        if (this.isReloading) throw new AccountMutationConflictError();
        const nextConfig = deepClone(config);
        const configKey = `${config.platform}.${config.account_id}`;
        this.validateAccountConfigCandidate(configKey, nextConfig);
        const adapterExisted = this.adapters.has(config.platform);
        const adapter = this.findOrCreateAdapter<P>(config.platform);
        if (!adapter) return;
        try {
            if (adapter.accounts.has(config.account_id)) {
                throw new ValidationError(
                    `账号 ${config.platform}.${config.account_id} 已存在，请使用编辑操作`,
                );
            }
            await mutateAccountAtomically({
                host: this,
                adapter,
                accountId: config.account_id,
                nextConfig,
                configKey,
                configPath: BaseApp.configPath,
                runtimeStarted: this.isStarted,
                onPersisted: (configPath, content) => this.onConfigPersisted(configPath, content),
            });
        } catch (error) {
            if (!adapterExisted && adapter.accounts.size === 0) {
                this.adapters.delete(config.platform);
            }
            throw error;
        }
    }

    public async updateAccount<P extends keyof Adapter.Configs>(config: Adapter.Configs[P]) {
        assertAccountIdentity(config);
        if (this.isReloading) throw new AccountMutationConflictError();
        const adapter = this.adapters.get(config.platform);
        if (!adapter) return this.addAccount(config);
        const account = adapter.accounts.get(config.account_id);
        if (!account) return this.addAccount(config);
        const key = `${config.platform}.${config.account_id}`;
        const newConfig = deepMerge(
            deepClone(this.config[key]),
            deepClone(config),
        ) as Account.Config<P>;
        this.validateAccountConfigCandidate(key, newConfig);
        await mutateAccountAtomically({
            host: this,
            adapter,
            accountId: config.account_id,
            nextConfig: newConfig,
            configKey: key,
            configPath: BaseApp.configPath,
            runtimeStarted: this.isStarted,
            onPersisted: (configPath, content) => this.onConfigPersisted(configPath, content),
        });
    }

    public async removeAccount(p: string, uin: string, force?: boolean) {
        assertAccountIdentifier("platform", p);
        assertAccountIdentifier("account_id", uin);
        if (this.isReloading) throw new AccountMutationConflictError();
        const adapter = this.adapters.get(p);
        if (!adapter) return this.logger.warn(`未找到适配器${p}`);
        const account = adapter.accounts.get(uin);
        if (!account) return this.logger.warn(`未找到账号${uin}`);
        await mutateAccountAtomically({
            host: this,
            adapter,
            accountId: uin,
            configKey: `${p}.${uin}`,
            configPath: BaseApp.configPath,
            runtimeStarted: this.isStarted,
            forceStop: force,
            onPersisted: (configPath, content) => this.onConfigPersisted(configPath, content),
        });
    }

    /** 配置由核心账号操作成功落盘后的扩展钩子。 */
    protected onConfigPersisted(_configPath: string, _content: string): void {}

    /** 主程序可覆写此钩子，以当前已加载插件的 Schema 校验单账号候选配置。 */
    protected validateAccountConfigCandidate(_configKey: string, _config: Account.Config): void {}

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

    private async startAdapters(throwOnFailure = false): Promise<void> {
        const failures = new FailureCollector();
        for (const [platform, adapter] of this.adapters) {
            await failures.capture(
                () => adapter.start(),
                error => {
                    const wrappedError = ErrorHandler.wrap(error, { platform });
                    this.enhancedLogger.error(wrappedError, { platform });
                },
            );
        }
        if (throwOnFailure) failures.throwIfAny(`${failures.size} 个适配器启动失败`);
    }

    private async stopAdapters(throwOnFailure = false): Promise<void> {
        const failures = new FailureCollector();
        await Promise.all(
            [...this.adapters].map(async ([platform, adapter]) => {
                await failures.capture(
                    () => adapter.stop(),
                    error => {
                        const wrappedError = ErrorHandler.wrap(error, { platform });
                        this.enhancedLogger.error(wrappedError, { platform });
                    },
                );
            }),
        );
        if (throwOnFailure) failures.throwIfAny(`${failures.size} 个适配器停止失败`);
    }

    protected async rollbackFailedStart(error: unknown): Promise<never> {
        return rollbackStartup(
            error,
            () => this.stop(),
            wrappedError => this.enhancedLogger.fatal(wrappedError),
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
                `Server listening at http://0.0.0.0:${listeningPort}${this.config.path || "/"}`,
                { port: listeningPort, path: this.config.path },
            );

            await this.startAdapters();

            this.isStarted = true;
            stopTimer();
        } catch (error) {
            stopTimer();
            await this.rollbackFailedStart(error);
        }
    }
    async reload(config: BaseApp.Config) {
        const runtimeLease = acquireRuntimeOperation(
            this,
            "configuration_reload",
            () => new ConfigError("OneBots 运行态正在变更，请等待当前操作完成"),
        );

        try {
            const merged = deepMerge(deepClone(BaseApp.defaultConfig), deepClone(config));
            const next = ConfigValidator.validateWithDefaults(
                merged as Partial<Required<BaseApp.Config>>,
                BaseAppConfigSchema,
            );
            assertHostConfigReloadable(this.config, next);

            const previous = this.config;
            const wasStarted = this.isStarted;
            let previousStopped = false;

            try {
                await this.stopAdapters(true);
                previousStopped = true;
                this.adapters.clear();
                this.config = next;
                this.logger.level = next.log_level;
                this.enhancedLogger.setLevel(next.log_level);
                this.initAdapters();
                if (wasStarted) await this.startAdapters(true);
            } catch (error) {
                if (!previousStopped) {
                    throw ErrorHandler.wrap(error, {
                        operation: "reload",
                        phase: "stop-previous",
                    });
                }

                const failures = new FailureCollector();
                failures.add(error);
                await failures.capture(() => this.stopAdapters(true));
                this.adapters.clear();
                this.config = previous;
                this.logger.level = previous.log_level;
                await failures.capture(() => this.enhancedLogger.setLevel(previous.log_level));
                let previousInitialized = false;
                await failures.capture(() => {
                    this.initAdapters();
                    previousInitialized = true;
                });
                if (wasStarted && previousInitialized) {
                    await failures.capture(() => this.startAdapters(true));
                }
                try {
                    failures.throwIfAny("配置重载失败且运行态回滚未完整完成");
                } catch (finalError) {
                    throw ErrorHandler.wrap(finalError, { operation: "reload" });
                }
            }
        } finally {
            runtimeLease.release();
        }
    }
    async stop() {
        if (this.isDisposed) return;
        const stopTimer = this.enhancedLogger.start("Application stop");
        const failures = new FailureCollector();

        // 每个阶段都必须获得清理机会；完成后再统一传播扩展或资源失败。
        await failures.capture(() => this.lifecycle.stop());
        await failures.capture(() => this.stopAdapters(true));
        this.adapters.clear();
        await failures.capture(() => this.lifecycle.cleanup({ throwOnFailure: true }));
        await failures.capture(() => closeSecurityAudit());
        await failures.capture(() => emitAllAwaited(this, "close"));

        this.isStarted = false;
        this.isDisposed = true;
        stopTimer();

        try {
            failures.throwIfAny(`${failures.size} 个应用停止操作失败`);
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
    /** 当前运行时配置文件名；与 configDir 分开保存，以保持自定义 -c 路径身份。 */
    export let configFileName = "config.yaml";
}
