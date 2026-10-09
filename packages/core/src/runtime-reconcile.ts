import type { BaseApp } from "./base-app.js";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import { AdapterRegistry, ProtocolRegistry } from "./registry.js";
import { createAccountWithRouteScope } from "./scoped-account.js";
import { closeAdapterRouteScope } from "./scoped-adapter.js";
import { deepClone } from "./utils.js";
import { ConfigValidator } from "./config-validator.js";
import { parseAccountConfigKey } from "./account-config.js";
import {
    effectiveProtocolConfig,
    isProtocolKey,
    planRuntimeConfiguration,
    RuntimeConfigurationRejectedError,
    type RuntimeConfigurationResult,
} from "./runtime-configuration.js";

/** 一个配置批次只接触差异中的实例；回滚同样不得重启无关账号。 */
export async function reconcileRuntimeConfiguration(
    app: BaseApp,
    next: Required<BaseApp.Config>,
): Promise<RuntimeConfigurationResult> {
    const previous = app.config;
    const impact = planRuntimeConfiguration(previous, next);
    if (impact.mode === "restart")
        throw new RuntimeConfigurationRejectedError(
            `以下配置需要重启: ${impact.restartReasons.join(", ")}`,
        );
    if (impact.mode === "none") {
        // 有效值相同仍可能改变默认值/覆盖值的归属；保留新快照供下一次差异规划。
        app.config = next;
        synchronizeAccountConfigs(app, next);
        return { status: "applied", impact };
    }
    for (const change of impact.accounts) {
        if (change.action !== "remove" && !AdapterRegistry.has(change.platform)) {
            throw new RuntimeConfigurationRejectedError(
                `平台 ${change.platform} 尚未安装，无法热应用配置`,
            );
        }
    }
    for (const change of impact.protocols) {
        if (change.action !== "remove" && !ProtocolRegistry.has(change.name, change.version)) {
            throw new RuntimeConfigurationRejectedError(
                `协议 ${change.name}/${change.version} 尚未安装`,
            );
        }
    }
    const undo: Array<() => Promise<void>> = [];
    const createdAdapters = new Set<Adapter>();
    const wasStarted = app.isStarted || app.httpServer.listening;
    // 所有候选 Schema 在关闭任何旧连接之前校验；错误不携带候选原文。
    try {
        for (const key of Object.keys(next)) {
            const identity = parseAccountConfigKey(key);
            if (!identity) continue;
            const candidate = accountConfig(next, key, identity.platform, identity.account_id);
            const schema = AdapterRegistry.getSchema(identity.platform);
            if (schema) ConfigValidator.validate(candidate, schema);
            for (const field of Object.keys(candidate)) {
                if (!isProtocolKey(field)) continue;
                const [name, version] = field.split(".");
                if (!ProtocolRegistry.has(name, version)) throw new Error("协议尚未安装");
                const protocolSchema = ProtocolRegistry.getSchema(field);
                if (protocolSchema)
                    ConfigValidator.validate(
                        effectiveProtocolConfig(next, candidate, field),
                        protocolSchema,
                    );
            }
        }
    } catch {
        throw new RuntimeConfigurationRejectedError("扩展配置校验失败，热配置未受理");
    }
    const affected = new Map(
        [...impact.accounts, ...impact.protocols].map(change => [
            `${change.platform}/${change.accountId}`,
            change,
        ]),
    );
    const targets = [...affected.values()].flatMap(change => {
        const account = app.adapters.get(change.platform)?.accounts.get(change.accountId);
        return account
            ? [
                  {
                      account,
                      timeoutMs: Math.min(account.startupTimeoutSeconds * 1000, 5_000),
                  },
              ]
            : [];
    });
    const drains = targets.map(({ account, timeoutMs }) => ({
        drain: account.beginOperationDrain(),
        timeoutMs,
    }));
    try {
        await Promise.all(drains.map(({ drain, timeoutMs }) => drain.settled(timeoutMs)));
    } catch {
        for (const { drain } of drains) drain.release();
        // 没有关闭连接、替换实例或更新快照；不能把排空超时描述成已执行后的回滚。
        throw new RuntimeConfigurationRejectedError(
            "账号仍有进行中的操作，热配置未受理，请稍后重试",
        );
    }
    app.config = next;
    try {
        for (const change of impact.accounts) {
            const key = `${change.platform}.${change.accountId}`;
            const existing = app.adapters.get(change.platform);
            // 删除配置中残留、但运行态不存在的实例是幂等操作，不创建空适配器。
            if (change.action === "remove" && !existing?.accounts.has(change.accountId)) continue;
            const adapter = existing ?? app.findOrCreateAdapter(change.platform);
            if (!existing) createdAdapters.add(adapter);
            const old = adapter.accounts.get(change.accountId);
            const oldConfig = old ? deepClone(old.config) : undefined;
            undo.push(async () => {
                const active = adapter.accounts.get(change.accountId);
                if (active) {
                    await stopBounded(app, accountStopTimeout(active), () => active.stop(true));
                    adapter.accounts.delete(change.accountId);
                }
                if (oldConfig) {
                    const restored = createAccountWithRouteScope(app, adapter, oldConfig);
                    adapter.accounts.set(change.accountId, restored);
                    if (wasStarted) await restored.start();
                }
            });
            if (old) {
                await stopBounded(app, accountStopTimeout(old), () => old.stop());
                adapter.accounts.delete(change.accountId);
            }
            if (change.action !== "remove") {
                const candidate = createAccountWithRouteScope(
                    app,
                    adapter,
                    accountConfig(next, key, change.platform, change.accountId),
                );
                adapter.accounts.set(change.accountId, candidate);
                if (wasStarted) await candidate.start();
            }
        }
        for (const change of impact.protocols) {
            const key = `${change.platform}.${change.accountId}`;
            const account = app.adapters.get(change.platform)?.accounts.get(change.accountId);
            if (!account) {
                if (change.action === "remove") continue;
                throw new Error(`账号 ${change.platform}/${change.accountId} 不存在`);
            }
            const old = account.protocols.find(
                protocol => protocol.name === change.name && protocol.version === change.version,
            );
            const oldConfig = old ? (deepClone(old.config) as Record<string, unknown>) : undefined;
            undo.push(async () => {
                const active = account.protocols.find(
                    protocol =>
                        protocol.name === change.name && protocol.version === change.version,
                );
                if (active) {
                    await stopBounded(app, accountStopTimeout(account), () =>
                        account.stopProtocol(active, true),
                    );
                    account.protocols = account.protocols.filter(protocol => protocol !== active);
                }
                if (oldConfig) {
                    const restored = account.createProtocol(change.name, change.version, oldConfig);
                    account.protocols.push(restored);
                    if (wasStarted) await startProtocolBounded(account, restored);
                }
            });
            if (old) {
                await stopBounded(app, accountStopTimeout(account), () =>
                    account.stopProtocol(old),
                );
                account.protocols = account.protocols.filter(protocol => protocol !== old);
            }
            if (change.action !== "remove") {
                const config = effectiveProtocolConfig(
                    next,
                    next[key] as Record<string, unknown>,
                    `${change.name}.${change.version}`,
                );
                const candidate = account.createProtocol(change.name, change.version, config);
                account.protocols.push(candidate);
                if (wasStarted) await startProtocolBounded(account, candidate);
            }
        }
        synchronizeAccountConfigs(app, next);
        updateLogLevel(app);
        return { status: "applied", impact };
    } catch (error) {
        // 第三方错误可能包含连接凭据；只记录固定阶段，不写入原始 Error。
        app.logger.error("配置热应用失败，正在恢复受影响实例", { phase: "apply" });
        app.config = previous;
        if (error instanceof RuntimeStopTimeoutError) {
            // 第三方 stop 不能可靠取消。迟到停止仍可能改变资源，禁止同时创建恢复实例。
            app.logger.error("实例停止结果尚未确定，配置需要完整恢复", { phase: "stop" });
            return { status: "recovery_required", impact };
        }
        let recovered = true;
        for (const restore of undo.reverse()) {
            try {
                await restore();
            } catch {
                recovered = false;
                app.logger.error("配置热应用回滚未完整完成", { phase: "rollback" });
            }
        }
        for (const adapter of createdAdapters) {
            if (adapter.accounts.size) continue;
            app.adapters.delete(String(adapter.platform));
            closeAdapterRouteScope(adapter);
        }
        // 无法停止候选实例时保留它的真实配置，不能用旧配置标签掩盖恢复失败。
        if (recovered) synchronizeAccountConfigs(app, previous);
        updateLogLevel(app);
        return { status: recovered ? "rolled_back" : "recovery_required", impact };
    } finally {
        for (const { drain } of drains) drain.release();
    }
}

class RuntimeStopTimeoutError extends Error {}

const pendingStops = new WeakMap<BaseApp, Set<Promise<void>>>();

/** 超时不是取消；未确定的旧停止完成之前，禁止启动/重载造成连接重叠。 */
export function hasPendingRuntimeStop(app: BaseApp): boolean {
    return Boolean(pendingStops.get(app)?.size);
}

/** 应用最终停机必须先等待热配置中已发起、但曾超时的第三方停止任务。 */
export async function settlePendingRuntimeStops(app: BaseApp): Promise<void> {
    const active = pendingStops.get(app);
    while (active?.size) await Promise.allSettled([...active]);
}

function accountStopTimeout(account: Account): number {
    return Math.min(account.startupTimeoutSeconds * 1000, 5_000);
}

/** 有界等待只给出未知结果，不把超时误当成可安全重试的停止失败。 */
async function stopBounded(
    app: BaseApp,
    timeoutMs: number,
    stop: () => Promise<void>,
): Promise<void> {
    let timer: NodeJS.Timeout | undefined;
    const active = pendingStops.get(app) ?? new Set<Promise<void>>();
    pendingStops.set(app, active);
    const pending = Promise.resolve().then(stop);
    active.add(pending);
    void pending
        .finally(() => active.delete(pending))
        .catch(() => {
            // 错误由下面的有界等待或事务恢复报告；此旁路只清理租约。
        });
    try {
        await Promise.race([
            pending,
            new Promise<never>((_, reject) => {
                timer = setTimeout(
                    () => reject(new RuntimeStopTimeoutError("停止超时")),
                    timeoutMs,
                );
                timer.unref?.();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

function accountConfig(
    config: BaseApp.Config,
    key: string,
    platform: string,
    accountId: string,
): Account.Config {
    return { ...deepClone(config[key]), platform, account_id: accountId } as Account.Config;
}

function synchronizeAccountConfigs(app: BaseApp, config: BaseApp.Config): void {
    for (const account of app.accounts) {
        const key = `${account.platform}.${account.account_id}`;
        if (config[key])
            account.config = accountConfig(
                config,
                key,
                String(account.platform),
                String(account.account_id),
            );
    }
}

function updateLogLevel(app: BaseApp): void {
    app.logger.level = app.config.log_level;
    app.enhancedLogger.setLevel(app.config.log_level);
    for (const adapter of app.adapters.values()) adapter.logger.level = app.config.log_level;
}

/** 独立协议热启动同样有时间与取消边界，不能无限占住整批配置事务。 */
async function startProtocolBounded(
    account: Account,
    protocol: Account["protocols"][number],
): Promise<void> {
    const controller = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    try {
        await Promise.race([
            account.startProtocol(protocol, controller.signal),
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => {
                    controller.abort();
                    reject(new Error(`协议 ${protocol.name}/${protocol.version} 热启动超时`));
                }, account.startupTimeoutSeconds * 1000);
                timer.unref?.();
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}
