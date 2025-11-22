import { EventEmitter } from "events";
import { Account } from "@/account";
import { Adapter } from "@/adapter";
import { Logger } from "log4js";
import { Dict } from "@zhinjs/shared";
import { Router } from "@/server/router";
import { App } from "@/server/app";

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
    get app(): App {
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
    protected get path(): string {
        return `/${this.account.platform}/${this.account.account_id}/${this.config.protocol}/${this.config.version}`;
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
    export interface ConfigMaps extends Record<string, Record<string, any>> { }
    /**
     * Base configuration for protocols
     */
    export type Config<T extends Record<string, any> = Record<string, any>> = T & {
        filters?: Filters;
    }
    export type FullConfig<T extends Record<string, any> = Record<string, any>> = T & {
        filters?: Filters;
        protocol: string
        version: string;
    }
    export type Configs = {
      [P in keyof ConfigMaps]: {
        [V in keyof ConfigMaps[P] as `${P}.${V & string}`]: Config<ConfigMaps[P][V]>
      } 
    }[keyof ConfigMaps];

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

    /**
     * Protocol factory function
     */
    export type Factory<T extends Protocol = Protocol> = new (
        adapter: Adapter,
        account: Account,
        config: any,
    ) => T;

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
