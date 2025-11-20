import { EventEmitter } from "events";
import { App } from "@/server/app";
import { OneBot } from "@/onebot";
import { Logger } from "log4js";
import { CommonEvent, CommonAction } from "@/common-types";
import { Dict } from "@zhinjs/shared";

/**
 * Base Adapter class
 * Platform adapters extract data from their platforms into CommonEvent format
 * Protocol implementations then convert CommonEvent to their specific formats
 */
export abstract class Adapter<T extends string = string> extends EventEmitter {
    oneBots: Map<string, OneBot> = new Map<string, OneBot>();
    #logger: Logger;
    icon: string;

    protected constructor(
        public app: App,
        public platform: T,
        public config: Adapter.Configs[T],
    ) {
        super();
    }

    /**
     * Extract platform-specific event data into common event format
     * This is the key method that platform adapters must implement
     */
    protected abstract extractEvent(rawEvent: any): CommonEvent.Event;

    /**
     * Convert common event to platform-specific action
     * Used to send messages, etc. back to the platform
     */
    protected abstract executeAction(action: CommonAction.SendMessage): Promise<{ message_id: string }>;

    /**
     * Handle incoming platform event
     * Extracts to common format, then dispatches to protocols
     */
    protected handlePlatformEvent(uin: string, rawEvent: any) {
        try {
            // Extract platform data into common structure
            const commonEvent = this.extractEvent(rawEvent);
            
            // Get the bot instance
            const oneBot = this.getOneBot(uin);
            if (!oneBot) {
                this.logger.warn(`No bot found for uin: ${uin}`);
                return;
            }

            // Dispatch to all protocol instances
            // Each protocol will convert the common event to its own format
            oneBot.dispatch(commonEvent);
        } catch (error) {
            this.logger.error(`Error handling platform event: ${error.message}`);
        }
    }

    getOneBot<C = any>(uin: string) {
        return this.oneBots.get(uin) as OneBot<C> | undefined;
    }

    get logger() {
        return (this.#logger ||= this.app.getLogger(this.platform));
    }

    get info() {
        return {
            platform: this.platform,
            config: this.config,
            icon: this.icon,
            bots: [...this.oneBots.values()].map(bot => {
                return bot.info;
            }),
        };
    }

    async setOnline(uin: string) {}
    async setOffline(uin: string) {}

    getLogger(uin: string, version?: string) {
        if (!version) return this.app.getLogger(`${this.platform}-${uin}`);
        return this.app.getLogger(`${this.platform}-${version}(${uin})`);
    }

    createOneBot<T = any>(uin: string, protocol: Dict, versions: OneBot.Config[]): OneBot<T> {
        const oneBot = new OneBot<T>(this, uin, versions);
        this.oneBots.set(uin, oneBot);
        return oneBot;
    }

    async start(uin?: string): Promise<any> {
        const startOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of startOneBots) {
            await oneBot.start();
        }
        this.app.emit("adapter.start", this.platform);
    }

    async stop(uin?: string, force?: boolean): Promise<any> {
        const stopOneBots = [...this.oneBots.values()].filter(oneBot => {
            return uin ? oneBot.uin === uin : true;
        });
        for (const oneBot of stopOneBots) {
            await oneBot.stop(force);
            await this.setOffline(oneBot.uin);
        }
        this.app.emit("adapter.stop", this.platform);
    }

    /**
     * Call platform-specific API
     * Protocols use this to send messages via the adapter
     */
    abstract call(uin: string, action: string, params: any): Promise<any>;
}

export namespace Adapter {
    export interface Configs {
        [key: string]: Adapter.Config;
    }

    export type Config<T extends string = string> = {
        platform?: T;
        versions: OneBot.Config<OneBot.Version>[];
        protocol?: Dict;
    } & Record<string, any>;
}
