import { Protocol } from "../base";
import { Account } from "@/account";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";

/**
 * OneBot V11 Protocol Implementation
 * Wraps the V11 implementation to conform to the Protocol interface
 */
export class OneBotV11Protocol extends Protocol<"v11", Account.Config<'onebot',"V11">> {
    public readonly name = "onebot";
    public readonly version = "v11" as const;

    constructor(adapter: Adapter, oneBot: Account, config: Account.Config<'onebot',"V11">) {
        super(adapter, oneBot, config);
    }

    filterFn(event: Dict): boolean {
        // Implement OneBot11-specific event filtering
        // For now, accept all events
        return true;
    }
    start(): void {
        // do sth
    }

    async stop(force?: boolean): Promise<void> {
        // do sth
    }

    dispatch(event: any): void {
        this.emit("dispatch", JSON.stringify(event));
    }

    format(event: string, payload: any): any {
        // do sth
    }

    async apply(action: string, params?: any): Promise<any> {
        // return this.service.apply(action, params);
    }
}
export namespace OneBotV11Protocol {
    export interface Config {}
}
