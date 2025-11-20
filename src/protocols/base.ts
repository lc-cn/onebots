import { EventEmitter } from "events";
import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";
import { Logger } from "log4js";
import { Dict } from "@zhinjs/shared";

/**
 * Base Protocol class
 * Represents a communication protocol (e.g., OneBot, Milky, Satori)
 */
export abstract class Protocol<
    V extends string = string,
    Config extends Protocol.Config = Protocol.Config,
> extends EventEmitter {
    public abstract readonly name: string;
    public abstract readonly version: V;
    protected logger: Logger;

    constructor(
        public adapter: Adapter,
        public oneBot: OneBot,
        public config: Config,
    ) {
        super();
        this.logger = this.adapter.getLogger(this.oneBot.uin, `${this.name}/${this.version}`);
    }

    /**
     * Get the URL path for this protocol
     */
    protected get path(): string {
        return `/${this.oneBot.platform}/${this.name}/${this.version}`;
    }

    /**
     * Filter function to determine if event should be processed
     */
    abstract filterFn(event: Dict): boolean;

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
    export interface Config {
        filters?: Filters;
        [key: string]: any;
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

    /**
     * Protocol factory function
     */
    export type Factory<T extends Protocol = Protocol> = new (
        adapter: Adapter,
        oneBot: OneBot,
        config: any,
    ) => T;
}
