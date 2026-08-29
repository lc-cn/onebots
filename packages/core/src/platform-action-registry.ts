export type PlatformActionParams = Readonly<Record<string, unknown>>;

export type PlatformActionHandler<TContext> = (
    context: TContext,
    params: PlatformActionParams,
) => Promise<unknown>;

/** 兼顾精确动作联合类型与动态字符串探测的只读集合。 */
export type PlatformActionSet<TAction extends string> = Omit<ReadonlySet<TAction>, "has"> & {
    has(action: string): action is TAction;
};

export interface PlatformActionRegistry<TContext, TAction extends string> {
    /** 由 handler 表生成的不可变动作集合。 */
    readonly actions: PlatformActionSet<TAction>;
    has(action: string): action is TAction;
    execute(context: TContext, action: string, params: PlatformActionParams): Promise<unknown>;
}

type AnyPlatformActionHandler = PlatformActionHandler<never>;
type HandlerContext<T> = T extends PlatformActionHandler<infer TContext> ? TContext : never;
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
    value: infer TIntersection,
) => void
    ? TIntersection
    : never;
type RegistryContext<THandlers extends Readonly<Record<string, AnyPlatformActionHandler>>> =
    UnionToIntersection<HandlerContext<THandlers[keyof THandlers]>>;

/**
 * 用单一 handler 表同时驱动能力发现与执行。
 *
 * 动作集合在运行时同样不可变，调用方不能绕过 ReadonlySet 类型修改注册结果。
 */
export function definePlatformActions<
    const THandlers extends Readonly<Record<string, AnyPlatformActionHandler>>,
>(
    handlers: THandlers,
    unsupported: (action: string) => Error,
): PlatformActionRegistry<RegistryContext<THandlers>, Extract<keyof THandlers, string>> {
    type Action = Extract<keyof THandlers, string>;
    type Context = RegistryContext<THandlers>;
    const names = new ImmutableSet(Object.keys(handlers) as Action[]);
    return Object.freeze({
        actions: names,
        has(action: string): action is Action {
            return names.has(action as Action);
        },
        async execute(context: Context, action: string, params: PlatformActionParams) {
            const handler = handlers[action];
            if (!handler) throw unsupported(action);
            return Reflect.apply(handler, undefined, [context, params]) as unknown;
        },
    });
}

/** Set 的只读视图；不暴露 add/delete/clear。 */
class ImmutableSet<T extends string> implements ReadonlySet<T> {
    readonly #values: Set<T>;

    constructor(values: Iterable<T>) {
        this.#values = new Set(values);
    }

    get size(): number {
        return this.#values.size;
    }

    has(value: string): value is T {
        return this.#values.has(value as T);
    }

    entries(): SetIterator<[T, T]> {
        return this.#values.entries();
    }

    keys(): SetIterator<T> {
        return this.#values.keys();
    }

    values(): SetIterator<T> {
        return this.#values.values();
    }

    union<U>(other: ReadonlySetLike<U>): Set<T | U> {
        return this.#values.union(other);
    }

    intersection<U>(other: ReadonlySetLike<U>): Set<T & U> {
        return this.#values.intersection(other);
    }

    difference<U>(other: ReadonlySetLike<U>): Set<T> {
        return this.#values.difference(other);
    }

    symmetricDifference<U>(other: ReadonlySetLike<U>): Set<T | U> {
        return this.#values.symmetricDifference(other);
    }

    isSubsetOf(other: ReadonlySetLike<unknown>): boolean {
        return this.#values.isSubsetOf(other);
    }

    isSupersetOf(other: ReadonlySetLike<unknown>): boolean {
        return this.#values.isSupersetOf(other);
    }

    isDisjointFrom(other: ReadonlySetLike<unknown>): boolean {
        return this.#values.isDisjointFrom(other);
    }

    forEach(
        callbackfn: (value: T, value2: T, set: ReadonlySet<T>) => void,
        thisArg?: unknown,
    ): void {
        for (const value of this.#values) callbackfn.call(thisArg, value, value, this);
    }

    [Symbol.iterator](): SetIterator<T> {
        return this.values();
    }

    get [Symbol.toStringTag](): string {
        return "Set";
    }
}
