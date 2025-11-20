import { Protocol } from "../base";
import { V11 as OneBotV11 } from "./v11-impl";
import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";

/**
 * OneBot V11 Protocol Implementation
 * Wraps the V11 implementation to conform to the Protocol interface
 */
export class OneBotV11Protocol extends Protocol<"v11", OneBot.Config<"V11">> {
    public readonly name = "onebot";
    public readonly version = "v11" as const;
    private service: OneBotV11;

    constructor(adapter: Adapter, oneBot: OneBot, config: OneBot.Config<"V11">) {
        super(adapter, oneBot, config);
        // Use V11 implementation
        this.service = new OneBotV11(oneBot, config);
    }

    filterFn(event: Dict): boolean {
        return this.service.filterFn(event);
    }

    start(): void {
        this.service.start();
    }

    async stop(force?: boolean): Promise<void> {
        await this.service.stop(force);
    }

    dispatch(event: any): void {
        this.service.dispatch(event);
    }

    format(event: string, payload: any): any {
        return this.service.format(event, payload);
    }

    async apply(action: string, params?: any): Promise<any> {
        return this.service.apply(action, params);
    }

    // Expose service for access to implementation details
    get instance(): OneBotV11 {
        return this.service;
    }
}
