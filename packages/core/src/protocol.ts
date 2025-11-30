import { EventEmitter } from "events";
import { Account } from "@/account.js";
import { Adapter } from "@/adapter.js";
import { Dict } from "./types.js";
import { Router } from "./router.js";
import { BaseApp } from "@/base-app.js";

/**
 * Base Protocol class
 * Represents a communication protocol (e.g., OneBot, Milky, Satori)
 */
export abstract class Protocol<
    V extends string = string,
    C =any,
> extends EventEmitter {
    public abstract readonly name: string;
    public abstract readonly version: V;
    get app() {
        return this.adapter.app;
    }
    get router(): Router {
        return this.adapter.app.router;
    }
    get logger(){
        return this.app.getLogger(`${this.name}/${this.version}`)
    }
    constructor(
        public adapter: Adapter,
        public account: Account,
        public config: Protocol.FullConfig<C>,
    ) {
        super();
    }

    /**
     * Get the URL path for this protocol
     */
    get path(): string {
        return `${this.account.path}/${this.config.protocol}/${this.config.version}`;
    }

    /**
     * Filter function to determine if event should be processed
     */
    filterFn(event: Dict): boolean{
        return Protocol.createFilter(this.config.filters)(event);
    }

    /**
     * Start the protocol service
     */
    abstract start(): void | Promise<void>;

    /**
     * Stop the protocol service
     */
    abstract stop(force?: boolean): void | Promise<void>;

    /**
     * Dispatch an event through this protocol
     */
    abstract dispatch(event: any): void | Promise<void>;

    /**
     * Format event data according to protocol specifications
     */
    abstract format(event: string, payload: any): any;

    /**
     * Apply an action (call an API method)
     */
    abstract apply(action: string, params?: any): Promise<any>;
}

export namespace Protocol {
    /**
     * Base configuration for protocols
     */
    export type Config<T extends unknown = Record<string, any>> = T & {
        filters?: Filters;
    }
    export type FullConfig<T extends unknown = Record<string, any>> = Config<T> & {
        protocol: string
        version: string;
    }
    export interface Configs{
        
    }

    /**
     * Filter configuration
     */
    export type Filters = AttrFilter | WithFilter | UnionFilter | ExcludeFilter;

    type MaybeArray<T = any> = T | T[];

    type AttrFilter = {
        [P in keyof Dict]?: MaybeArray | boolean;
    };

    export type WithFilter = {
        $and: Filters;
    };

    export type UnionFilter = {
        $or: Filters;
    };

    export type ExcludeFilter = {
        $not: Filters;
    };

    /**
     * Protocol metadata
     */
    export interface Metadata {
        name: string;
        displayName: string;
        description: string;
        versions: string[];
    }
    export type Creator<T extends Protocol = Protocol> = (
        adapter: Adapter,
        account: Account,
        config: any,
    ) => T;
    export type Construct<T extends Protocol = Protocol> = {
        new (
            adapter: Adapter,
            account: Account,
            config: any,
        ): T;
    }
    /**
     * Protocol factory function
     */
    export type Factory<T extends Protocol = Protocol> = Creator<T> | Construct<T>;
    export function isClassFactory<T extends Protocol = Protocol>(factory: Factory<T>): factory is Construct<T> {
        return typeof factory === "function" && /^class\s/.test(Function.prototype.toString.call(factory));
    }

    export function createFilter(filters: Filters) {
        const isLogicKey = (key: string) => {
            return [
                "$and",
                "$or",
                "$not",
                "$nor",
                "$regexp",
                "$like",
                "$gt",
                "$gte",
                "$lt",
                "$lte",
                "$between",
            ].includes(key);
        };
        
        const filterFn = (event: Dict, key: string, value: any) => {
            // If key is $and, $or, $not, $nor, recursively call
            if (key === "$and" || key === "$or" || key === "$not" || key === "$nor") {
                if (!value || typeof value !== "object") throw new Error("invalid filter");
                switch (key) {
                    case "$and":
                        return Array.isArray(value)
                            ? value.every(item => filterFn(event, key, item))
                            : Object.entries(value).every(([key, value]) =>
                                  filterFn(event, key, value),
                              );
                    case "$or":
                        return Array.isArray(value)
                            ? value.some(item => filterFn(event, key, item))
                            : Object.entries(value).some(([key, value]) =>
                                  filterFn(event, key, value),
                              );
                    case "$nor":
                        return !filterFn(event, "$or", value);
                    case "$not":
                        return !filterFn(event, "$and", value);
                }
            }
            
            if (typeof value === "boolean" && typeof event[key] !== "boolean") {
                return value;
            }
            
            if (typeof value !== "object") {
                if (key === "$regex" && typeof value === "string")
                    return new RegExp(value).test(String(event));
                if (key === "$like" && typeof value === "string")
                    return String(event).includes(value);
                if (key === "$gt" && typeof value === "number") return Number(event) > value;
                if (key === "$gte" && typeof value === "number") return Number(event) >= value;
                if (key === "$lt" && typeof value === "number") return Number(event) < value;
                if (key === "$lte" && typeof value === "number") return Number(event) <= value;
                return value === event[key];
            }
            
            if (
                key === "$between" &&
                Array.isArray(value) &&
                value.length === 2 &&
                value.every(item => typeof item === "number")
            ) {
                const [start, end] = value as [number, number];
                return Number(event) >= start && Number(event) <= end;
            }
            
            if (Array.isArray(value)) {
                return value.includes(event[key]);
            }
            
            return createFilter(value)(isLogicKey(key) ? event : event[key]);
        };
        
        return (event: Dict) => {
            return Object.entries(filters).every(([key, value]) => filterFn(event, key, value));
        };
    }
}
