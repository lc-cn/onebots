import type { Adapter, CommonEvent, CommonTypes } from "onebots";

export interface SatoriChannelRoute {
    scene_type: CommonTypes.Scene;
    scene_id: string;
    guild_id?: string;
}

/**
 * 保存 Satori channel 与通用消息场景之间的显式映射。
 *
 * Satori 的 channel_id 是不透明标识，不能从前缀或分隔符推断私聊、群聊或频道。
 * 路由优先从真实事件和目录 API 学习；只有能力清单能唯一确定场景时才允许推导。
 */
export class SatoriChannelRouteRegistry {
    private readonly routes = new Map<string, SatoriChannelRoute>();

    constructor(
        private readonly adapter: Adapter,
        private readonly accountId: string,
    ) {}

    remember(channelId: string, route: SatoriChannelRoute): void {
        this.routes.set(channelId, route);
    }

    rememberEvent(event: CommonEvent.Message): SatoriChannelRoute {
        const channelId =
            event.group?.channel_id?.string ?? event.group?.id.string ?? event.sender.id.string;
        const sceneId =
            event.message_type === "private"
                ? event.sender.id.string
                : (event.group?.channel_id?.string ?? event.group?.id.string ?? channelId);
        const route = {
            scene_type: event.message_type,
            scene_id: sceneId,
            guild_id: event.group?.guild_id?.string,
        } satisfies SatoriChannelRoute;

        this.remember(channelId, route);
        return route;
    }

    rememberDirectoryChannel(
        channelId: string,
        sceneType: "channel" | "direct",
        guildId?: string,
    ): void {
        this.remember(channelId, {
            scene_type: sceneType,
            scene_id: channelId,
            guild_id: guildId,
        });
    }

    resolve(channelId: string): SatoriChannelRoute {
        const known = this.routes.get(channelId);
        if (known) return known;

        const actions = this.adapter.describeCapabilities(this.accountId).actions;
        const hasGroupDirectory = Boolean(actions.get_group_info);
        const hasChannelDirectory = Boolean(actions.get_channel_info);

        if (hasGroupDirectory !== hasChannelDirectory) {
            const route: SatoriChannelRoute = {
                scene_type: hasGroupDirectory ? "group" : "channel",
                scene_id: channelId,
            };
            this.remember(channelId, route);
            return route;
        }

        throw new Error(
            `无法确定 channel_id ${channelId} 的消息场景；请先通过事件或频道目录获取该频道`,
        );
    }
}
