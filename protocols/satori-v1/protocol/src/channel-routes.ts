import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
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
const SCENE_TYPES: ReadonlySet<string> = new Set(["private", "group", "channel", "direct"]);
const SAVE_DELAY_MS = 200;

/** 以平台与账户标识的完整摘要隔离路由文件，可读前缀仅便于排查。 */
export function routeStoreName(platform: string, accountId: string): string {
    const hash = createHash("sha256")
        .update(JSON.stringify([platform, accountId]))
        .digest("hex");
    const label = `${platform}-${accountId}`.replace(/[^\w.-]/g, "_").slice(0, 48);
    return `${label}-${hash}.json`;
}

export interface SatoriRouteLogger {
    warn(message: string, context?: Record<string, unknown>): void;
}

function errorContext(error: unknown): Record<string, unknown> {
    return { error: error instanceof Error ? error.message : String(error) };
}

function parseRoutes(raw: unknown): Map<string, SatoriChannelRoute> {
    const result = new Map<string, SatoriChannelRoute>();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return result;
    for (const [id, value] of Object.entries(raw)) {
        if (!value || typeof value !== "object") continue;
        const route = value as Record<string, unknown>;
        const guildId = route.guild_id;
        if (typeof route.scene_type !== "string" || !SCENE_TYPES.has(route.scene_type)) continue;
        if (typeof route.scene_id !== "string" || !route.scene_id) continue;
        if (guildId !== undefined && typeof guildId !== "string") continue;
        const parsed: SatoriChannelRoute = {
            scene_type: route.scene_type as CommonTypes.Scene,
            scene_id: route.scene_id,
        };
        if (typeof guildId === "string") parsed.guild_id = guildId;
        result.set(id, parsed);
    }
    return result;
}

export class SatoriChannelRouteRegistry {
    private readonly routes = new Map<string, SatoriChannelRoute>();
    private dirty = false;
    private timer?: NodeJS.Timeout;

    constructor(
        private readonly adapter: Adapter,
        private readonly accountId: string,
        private readonly storeFile?: string,
        private readonly logger?: SatoriRouteLogger,
    ) {
        for (const [id, route] of this.readStore()) this.routes.set(id, route);
    }

    private readStore(): Map<string, SatoriChannelRoute> {
        if (!this.storeFile) return new Map();
        try {
            return parseRoutes(JSON.parse(fs.readFileSync(this.storeFile, "utf8")));
        } catch (error) {
            if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
                this.logger?.warn(
                    `读取 Satori 路由存档失败：${this.storeFile}`,
                    errorContext(error),
                );
            }
            return new Map();
        }
    }

    /** 立即写盘：与磁盘上的最新内容合并后，经临时文件原子替换。 */
    flush(): void {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
        if (!this.storeFile || !this.dirty) return;
        const tmpFile = `${this.storeFile}.${process.pid}.tmp`;
        try {
            const merged = this.readStore();
            for (const [id, route] of this.routes) merged.set(id, route);
            fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
            fs.writeFileSync(tmpFile, JSON.stringify(Object.fromEntries(merged)));
            fs.renameSync(tmpFile, this.storeFile);
            this.dirty = false;
        } catch (error) {
            this.logger?.warn(`写入 Satori 路由存档失败：${this.storeFile}`, errorContext(error));
            fs.rmSync(tmpFile, { force: true });
            this.scheduleSave();
        }
    }

    private scheduleSave(): void {
        if (!this.storeFile || this.timer) return;
        this.timer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
        this.timer.unref?.();
    }

    remember(channelId: string, route: SatoriChannelRoute): void {
        const old = this.routes.get(channelId);
        this.routes.set(channelId, route);
        if (
            !old ||
            old.scene_type !== route.scene_type ||
            old.scene_id !== route.scene_id ||
            old.guild_id !== route.guild_id
        ) {
            this.dirty = true;
        }
        if (this.dirty) this.scheduleSave();
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
