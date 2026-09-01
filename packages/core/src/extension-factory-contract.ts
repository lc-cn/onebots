import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";
import type { BaseApp } from "./base-app.js";
import { ValidationError } from "./errors.js";
import type { Protocol } from "./protocol.js";

const ADAPTER_METHODS = [
    "callAction",
    "createAccount",
    "createId",
    "describeCapabilities",
    "emit",
    "getAccount",
    "isActionImplemented",
    "off",
    "on",
    "resolveId",
    "start",
    "stop",
] as const;

const PROTOCOL_METHODS = ["start", "stop", "dispatch", "format", "apply", "on", "off"] as const;

/** 在实例进入 App 前验证第三方适配器工厂没有越过注册身份与宿主边界。 */
export function assertAdapterFactoryContract(
    candidate: unknown,
    name: string,
    app: BaseApp,
): asserts candidate is Adapter {
    const instance = requireObject(candidate, `适配器 ${name} 工厂必须返回对象实例`);
    if (instance.platform !== name) {
        throw new ValidationError(
            `适配器 ${name} 工厂返回的平台身份不一致：实际为 ${formatIdentity(instance.platform)}`,
            { context: { name, actualPlatform: formatIdentity(instance.platform) } },
        );
    }
    if (instance.app !== app) {
        throw new ValidationError(`适配器 ${name} 工厂返回了不属于当前宿主的实例`, {
            context: { name },
        });
    }
    if (!(instance.accounts instanceof Map)) {
        throw new ValidationError(`适配器 ${name} 工厂返回值缺少账号集合`, {
            context: { name },
        });
    }
    assertMethods(instance, ADAPTER_METHODS, `适配器 ${name}`);
}

/** 在实例挂入账号前验证第三方协议工厂的身份、所有权和运行接口。 */
export function assertProtocolFactoryContract(
    candidate: unknown,
    name: string,
    version: string,
    adapter: Adapter,
    account: Account,
): asserts candidate is Protocol {
    const label = `协议 ${name}/${version}`;
    const instance = requireObject(candidate, `${label} 工厂必须返回对象实例`);
    if (instance.name !== name || instance.version !== version) {
        throw new ValidationError(
            `${label} 工厂返回的协议身份不一致：实际为 ${formatIdentity(instance.name)}/${formatIdentity(instance.version)}`,
            {
                context: {
                    name,
                    version,
                    actualName: formatIdentity(instance.name),
                    actualVersion: formatIdentity(instance.version),
                },
            },
        );
    }
    if (instance.adapter !== adapter || instance.account !== account) {
        throw new ValidationError(`${label} 工厂返回了不属于当前账号的实例`, {
            context: { name, version },
        });
    }
    const config = requireObject(instance.config, `${label} 工厂返回值缺少有效配置对象`);
    if (config.protocol !== name || config.version !== version) {
        throw new ValidationError(
            `${label} 工厂返回的配置身份不一致：实际为 ${formatIdentity(config.protocol)}/${formatIdentity(config.version)}`,
            { context: { name, version } },
        );
    }
    assertMethods(instance, PROTOCOL_METHODS, label);
}

function requireObject(value: unknown, message: string): Record<string, unknown> {
    if (typeof value !== "object" || value === null) {
        throw new ValidationError(message);
    }
    return value as Record<string, unknown>;
}

function assertMethods(
    instance: Record<string, unknown>,
    methods: readonly string[],
    label: string,
): void {
    const missing = methods.filter(method => typeof instance[method] !== "function");
    if (missing.length) {
        throw new ValidationError(`${label} 工厂返回值缺少必需方法：${missing.join("、")}`, {
            context: { missing },
        });
    }
}

function formatIdentity(value: unknown): string {
    return typeof value === "string" && value ? value : "未声明";
}
