import type { DiscordInteraction, DiscordInteractionResponse } from "../types.js";
import { InteractionType } from "./interaction-types.js";

export type InteractionHandler = (
    interaction: DiscordInteraction,
) => DiscordInteractionResponse | Promise<DiscordInteractionResponse>;

type InteractionRouteKind = "command" | "component" | "modal" | "autocomplete";

/**
 * Discord Interaction 的确定性路由表。
 * 组件先精确匹配，再选择最长前缀，避免结果依赖处理器注册顺序。
 */
export class InteractionRouter {
    private readonly handlers = new Map<string, InteractionHandler>();

    register(kind: InteractionRouteKind, key: string, handler: InteractionHandler): void {
        this.handlers.set(`${kind}:${key}`, handler);
    }

    resolve(interaction: DiscordInteraction): InteractionHandler | undefined {
        const { type, data } = interaction;
        if (!data) return undefined;
        switch (type) {
            case InteractionType.ApplicationCommand:
                return this.handlers.get(`command:${data.name}`);
            case InteractionType.MessageComponent:
                return this.resolveComponent(data.custom_id);
            case InteractionType.ModalSubmit:
                return this.handlers.get(`modal:${data.custom_id}`);
            case InteractionType.ApplicationCommandAutocomplete:
                return this.handlers.get(`autocomplete:${data.name}`);
            default:
                return undefined;
        }
    }

    private resolveComponent(customId?: string): InteractionHandler | undefined {
        if (!customId) return undefined;
        const exact = this.handlers.get(`component:${customId}`);
        if (exact) return exact;

        let bestPrefixLength = -1;
        let bestHandler: InteractionHandler | undefined;
        for (const [route, handler] of this.handlers) {
            if (!route.startsWith("component:")) continue;
            const prefix = route.slice("component:".length);
            if (prefix.length > bestPrefixLength && customId.startsWith(prefix)) {
                bestPrefixLength = prefix.length;
                bestHandler = handler;
            }
        }
        return bestHandler;
    }
}
