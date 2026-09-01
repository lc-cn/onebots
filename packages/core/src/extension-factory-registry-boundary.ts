import { isDeepStrictEqual } from "node:util";
import { ValidationError } from "./errors.js";

interface RegistryBoundary<State> {
    capture(): State;
    restore(state: State): void;
}

/**
 * 扩展实例工厂只能创建候选实例；注册表写入必须留在插件加载事务中。
 * 工厂返回或抛错后都复验全局状态，避免无效候选留下注册、删除或清空副作用。
 */
export function invokeExtensionFactoryWithRegistryBoundary<Result, State>(
    label: string,
    operation: () => Result,
    boundary: RegistryBoundary<State>,
): Result {
    const snapshot = boundary.capture();
    let returned = false;
    let result: Result | undefined;
    let factoryError: unknown;
    try {
        result = operation();
        returned = true;
    } catch (error) {
        factoryError = error;
    }

    if (!isDeepStrictEqual(boundary.capture(), snapshot)) {
        const violation = new ValidationError(
            `${label} 工厂不得修改扩展注册表；实例工厂只能创建候选实例`,
            {
                context: { factory: label },
                ...(factoryError instanceof Error ? { cause: factoryError } : {}),
            },
        );
        try {
            boundary.restore(snapshot);
        } catch (error) {
            throw new AggregateError(
                [violation, error],
                `${label} 工厂越过注册表边界且扩展注册表无法恢复`,
            );
        }
        throw violation;
    }
    if (!returned) throw factoryError;
    return result!;
}
