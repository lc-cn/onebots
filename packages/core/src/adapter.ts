import { BaseApp } from "./base-app.js";
import { CommonTypes } from "./types.js";
import { Account } from "./account.js";
import { Logger } from "log4js";
import { SqliteDB } from "./db.js";
import { buildTableName, createId, resolveId, coerceId } from "./adapter-id-manager.js";
import {
    adapterActionMethodName,
    assertSupportedActionsImplemented,
    EMPTY_ADAPTER_CAPABILITIES,
    isCanonicalAdapterAction,
    listSupportedActions,
    normalizeAdapterCapabilities,
    type AdapterCapabilityManifest,
} from "./adapter-capability.js";
import { UnsupportedCapabilityError, type UnsupportedCapabilityReason } from "./errors.js";
import { AdapterActionDefaults } from "./adapter-actions.js";
import { FailureCollector } from "./async-utils.js";
import "./adapter-types.js";
import "./adapter-types-extended.js";

/** 通用适配器基类：提供稳定动作接口，以能力清单明确平台差异。 */
export abstract class Adapter<
    C = unknown,
    T extends keyof Adapter.Configs = keyof Adapter.Configs,
    I extends BaseApp = BaseApp,
> extends AdapterActionDefaults {
    accounts: Map<string, Account<T, C>> = new Map<string, Account<T, C>>();
    #logger: Logger;
    readonly #capabilityManifest: AdapterCapabilityManifest;
    icon: string;

    get db(): SqliteDB {
        return this.app.db;
    }

    get tableName() {
        return buildTableName(String(this.platform));
    }

    protected constructor(
        public app: I,
        public platform: T,
        capabilityManifest: AdapterCapabilityManifest = EMPTY_ADAPTER_CAPABILITIES,
    ) {
        super();
        this.#capabilityManifest = normalizeAdapterCapabilities(capabilityManifest);
        this.db.create(this.tableName, {
            string: SqliteDB.Column("TEXT"),
            number: SqliteDB.Column("INTEGER", { unique: true }),
            source: SqliteDB.Column("TEXT"),
        });
    }

    // ID 管理方法
    createId(id: string | number, _retries: number = 0): CommonTypes.Id {
        return createId(id, this.tableName, this.db, _retries);
    }

    resolveId(id: string | number | CommonTypes.Id): CommonTypes.Id {
        return resolveId(id, this.tableName, this.db);
    }

    coerceId(value: CommonTypes.Id | string | number): CommonTypes.Id {
        return coerceId(value, this.tableName, this.db);
    }

    /** 返回当前适配器对外声明的能力；账号级动态能力可由子类覆写。 */
    describeCapabilities(_uin?: string): AdapterCapabilityManifest {
        return this.#capabilityManifest;
    }

    unsupported(
        capability: string,
        reason: UnsupportedCapabilityReason = "not_implemented",
        message?: string,
    ): never {
        throw new UnsupportedCapabilityError({
            platform: String(this.platform),
            capability,
            reason,
            message,
        });
    }

    async getSupportedActions(uin: string): Promise<string[]> {
        const manifest = this.describeCapabilities(uin);
        if (manifest === EMPTY_ADAPTER_CAPABILITIES) {
            return this.unsupported(
                "get_supported_actions",
                "not_implemented",
                `${this.platform} 适配器尚未声明能力清单`,
            );
        }
        assertSupportedActionsImplemented(this, manifest);
        return listSupportedActions(manifest);
    }

    /**
     * 从协议层调用能力清单中的动作。
     *
     * 标准动作统一使用 `(accountId, params)`；平台扩展动作必须显式覆写
     * executePlatformAction，避免将任意实例方法意外暴露为远程 API。
     */
    async callAction(
        uin: string,
        action: string,
        params: Readonly<Record<string, unknown>> = {},
    ): Promise<unknown> {
        const descriptor = this.describeCapabilities(uin).actions[action];
        if (!descriptor || descriptor.support === "unsupported") {
            return this.unsupported(action, "platform_unsupported");
        }

        if (action === "get_supported_actions") return this.getSupportedActions(uin);

        const methodName = adapterActionMethodName(action);
        if (isCanonicalAdapterAction(action)) {
            const baseMethod = (
                AdapterActionDefaults.prototype as unknown as Record<string, unknown>
            )[methodName];
            const instanceMethod = (this as unknown as Record<string, unknown>)[methodName];
            if (typeof instanceMethod !== "function" || instanceMethod === baseMethod) {
                return this.unsupported(action);
            }
            return Reflect.apply(instanceMethod, this, [uin, params]);
        }

        return this.executePlatformAction(uin, action, params);
    }

    /** 平台扩展动作的显式远程调用入口；子类应按 action 做穷尽路由。 */
    executePlatformAction(
        _uin: string,
        action: string,
        _params: Readonly<Record<string, unknown>>,
    ): Promise<unknown> {
        return this.unsupported(action);
    }

    /** 平台扩展动作必须同时声明可执行性，供能力契约检测清单漂移。 */
    isPlatformActionImplemented(_action: string): boolean {
        return false;
    }

    /** 能力契约使用该方法确认清单没有把基类占位实现误报为可用能力。 */
    isActionImplemented(action: string): boolean {
        if (action === "get_supported_actions") return true;

        if (!isCanonicalAdapterAction(action)) return this.isPlatformActionImplemented(action);

        const methodName = adapterActionMethodName(action);
        const instanceMethod = (this as unknown as Record<string, unknown>)[methodName];
        if (typeof instanceMethod !== "function") return false;

        const baseMethod = (AdapterActionDefaults.prototype as unknown as Record<string, unknown>)[
            methodName
        ];
        return instanceMethod !== baseMethod;
    }

    getAccount(uin: string) {
        return this.accounts.get(uin);
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform as string));
    }

    get info() {
        return {
            platform: this.platform,
            icon: this.icon,
            capabilities: this.describeCapabilities(),
            accounts: [...this.accounts.values()].map(account => account.info),
        };
    }

    async setOnline(_uin: string) {}
    async setOffline(_uin: string) {}

    submitVerification?(
        accountId: string,
        type: string,
        data: Record<string, unknown>,
    ): void | Promise<void>;
    requestSmsCode?(accountId: string): void | Promise<void>;

    abstract createAccount(config: Account.Config<T>): Account<T, C>;

    async start(account_id?: string): Promise<void> {
        this.logger.info(`Starting adapter for platform ${this.platform}`);
        const startAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        for (const account of startAccounts) {
            await account.start();
        }
        this.logger.info(`Adapter for platform ${this.platform} started`);
    }

    async stop(account_id?: string): Promise<void> {
        const stopAccounts = [...this.accounts.values()].filter(account => {
            return account_id ? account.account_id === account_id : true;
        });
        const failures = new FailureCollector();
        for (const account of stopAccounts) {
            await failures.capture(() => account.stop());
        }
        failures.throwIfAny(`${failures.size} 个适配器账号停止失败`);
    }
}

export type AdapterClient<T extends Adapter = Adapter> =
    T extends Adapter<infer C, keyof Adapter.Configs, BaseApp> ? C : never;

export namespace Adapter {
    /** 注册表运行时始终只传入宿主应用，工厂类型必须与真实调用约定一致。 */
    export type Construct<T> = { new (app: BaseApp): T };
    export type Creator<T> = (app: BaseApp) => T;
    export type Factory<T extends Adapter = Adapter> = Construct<T> | Creator<T>;
    export function isClassAdapter<T extends Adapter = Adapter>(obj: unknown): obj is Construct<T> {
        return typeof obj === "function" && /^class\s/.test(Function.prototype.toString.call(obj));
    }

    export interface Metadata {
        name: string;
        displayName: string;
        description: string;
        icon?: string;
        homepage?: string;
        author?: string;
        capabilities?: AdapterCapabilityManifest;
    }
}
