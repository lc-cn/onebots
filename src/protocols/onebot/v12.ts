import { Protocol } from "../base";
import { V12 as OneBotV12 } from "@/service/V12";
import { OneBot } from "@/onebot";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";

/**
 * OneBot V12 Protocol Implementation
 * Wraps the existing V12 service to conform to the new Protocol interface
 */
export class OneBotV12Protocol extends Protocol<"v12", OneBot.Config<"V12">> {
    public readonly name = "onebot";
    public readonly version = "v12" as const;
    private service: OneBotV12;

    constructor(adapter: Adapter, oneBot: OneBot, config: OneBot.Config<"V12">) {
        super(adapter, oneBot, config);
        // Reuse existing V12 service implementation
        this.service = new OneBotV12(oneBot, config);
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

    // Expose service for backward compatibility
    get instance(): OneBotV12 {
        return this.service;
    }
}
