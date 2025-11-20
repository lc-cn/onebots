import { Protocol } from "../base";
import { Account } from "@/account";
import { Adapter } from "@/adapter";
import { Dict } from "@zhinjs/shared";

/**
 * OneBot V12 Protocol Implementation
 * Wraps the V12 implementation to conform to the Protocol interface
 */
export class OneBotV12Protocol extends Protocol<"v12", Account.Config<'onebot',"V12">> {
    public readonly name = "onebot";
    public readonly version = "v12" as const;

    constructor(adapter: Adapter, oneBot: Account, config: Account.Config<'onebot',"V12">) {
        super(adapter, oneBot, config);
    }

    filterFn(event: Dict): boolean {
        // Implement OneBot12-specific event filtering
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
        // do sth
    }
}
export namespace OneBotV12Protocol {
    export interface Config {}
}

