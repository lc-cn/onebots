import { createGroupActions } from "./groups.js";
import { createInfoActions } from "./info.js";
import { createMessageActions } from "./messages.js";
import type { OneBotV11ActionContext, OneBotV11ActionHandler, OneBotV11Params } from "./types.js";

/**
 * OneBot V11 动作目录。标准动作与 OneBots 扩展动作在此统一分派；只有目录未实现的
 * 平台原生动作才回退到 Adapter.callAction，避免协议层和适配器层出现两套路由规则。
 */
export class OneBotV11ActionService {
    private readonly actions: Readonly<Record<string, OneBotV11ActionHandler>>;

    constructor(private readonly context: OneBotV11ActionContext) {
        this.actions = {
            ...createMessageActions(context),
            ...createGroupActions(context),
            ...createInfoActions(context),
        };
    }

    async execute(action: string, params: OneBotV11Params = {}): Promise<unknown> {
        const handler = this.actions[action];
        if (handler) return handler(params);

        const capabilities = this.context.adapter.describeCapabilities(this.context.accountId);
        if (capabilities.actions[action]) {
            return this.context.adapter.callAction(this.context.accountId, action, params);
        }
        throw new Error(`Unknown action: ${action}`);
    }
}
