import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
    ControlChatConversation,
    ControlChatHistoryQuery,
    ControlChatHistoryPage,
    ControlChatHistorySettings,
    ControlChatMessage,
} from "@onebots/core/control";

type NewMessage = Omit<ControlChatMessage, "id">;
const DAY = 86_400_000;
const MAX_TEXT = 32_768;
const MAX_ID = 512;
const MAX_NAME = 256;

function bounded(value: string, maximum: number): string {
    return value.slice(0, maximum);
}

function id(value: unknown): string | undefined {
    if (!value || typeof value !== "object") return undefined;
    const candidate = (value as { string?: unknown }).string;
    return typeof candidate === "string" && candidate.length > 0
        ? bounded(candidate, MAX_ID)
        : undefined;
}

function textForSegments(value: unknown): string {
    if (!Array.isArray(value)) return "";
    const parts: string[] = [];
    for (const segment of value.slice(0, 128)) {
        if (!segment || typeof segment !== "object") continue;
        const type = (segment as { type?: unknown }).type;
        const data = (segment as { data?: unknown }).data;
        if (type === "text" && data && typeof data === "object") {
            const text = (data as { text?: unknown }).text;
            if (typeof text === "string") parts.push(text);
        } else if (typeof type === "string") {
            const label = { image: "图片", video: "视频", audio: "音频", file: "文件" }[
                type as "image" | "video" | "audio" | "file"
            ];
            parts.push(`[${label ?? bounded(type, 32)}]`);
        }
    }
    return bounded(parts.join(""), MAX_TEXT);
}

function messageFromRow(row: Record<string, string | number | null>): ControlChatMessage {
    return {
        id: Number(row.id),
        platform: String(row.platform),
        accountId: String(row.account_id),
        sceneType: row.scene_type as ControlChatMessage["sceneType"],
        sceneId: String(row.scene_id),
        ...(row.guild_id !== null ? { guildId: String(row.guild_id) } : {}),
        ...(row.message_id !== null ? { messageId: String(row.message_id) } : {}),
        senderId: String(row.sender_id),
        senderName: String(row.sender_name),
        direction: row.direction as ControlChatMessage["direction"],
        text: String(row.text),
        time: Number(row.time),
    };
}

/** 不持久化 raw_event、资源 URL 或附件内容。仅接受规范化消息事件。 */
export function projectInboundChatMessage(
    platform: string,
    accountId: string,
    event: unknown,
): NewMessage | undefined {
    if (!event || typeof event !== "object") return undefined;
    const message = event as Record<string, unknown>;
    if (message.type !== "message") return undefined;
    const sender = message.sender as Record<string, unknown> | undefined;
    const group = message.group as Record<string, unknown> | undefined;
    const senderId = id(sender?.id);
    // direct 的会话身份由平台明确投影；旧适配器的 group.id 是安全的次级来源。
    const directConversationId =
        message.message_type === "direct" ? (id(message.scene_id) ?? id(group?.id)) : undefined;
    const scene =
        message.message_type === "direct"
            ? directConversationId
                ? "direct"
                : "private"
            : message.message_type;
    if (scene !== "private" && scene !== "direct" && scene !== "group" && scene !== "channel")
        return undefined;
    const sceneId =
        scene === "private"
            ? senderId
            : scene === "direct"
              ? directConversationId
              : id(scene === "channel" ? (group?.channel_id ?? group?.id) : group?.id);
    if (!senderId || !sceneId) return undefined;
    const name = typeof sender?.name === "string" ? sender.name : senderId;
    return {
        platform: bounded(platform, MAX_ID),
        accountId: bounded(accountId, MAX_ID),
        sceneType: scene,
        sceneId,
        ...(scene === "channel" && id(group?.guild_id) ? { guildId: id(group?.guild_id) } : {}),
        ...(id(message.message_id) ? { messageId: id(message.message_id) } : {}),
        senderId,
        senderName: bounded(name, MAX_NAME),
        direction: "inbound",
        text: textForSegments(message.message),
        time:
            typeof message.timestamp === "number" &&
            Number.isFinite(message.timestamp) &&
            message.timestamp > 0
                ? message.timestamp
                : Date.now(),
    };
}

export function projectOutboundChatMessage(
    platform: string,
    accountId: string,
    params: unknown,
    result: unknown,
): NewMessage | undefined {
    if (!params || typeof params !== "object") return undefined;
    const message = params as Record<string, unknown>;
    const sent = result && typeof result === "object" ? (result as Record<string, unknown>) : {};
    const confirmed =
        sent.scene && typeof sent.scene === "object"
            ? (sent.scene as Record<string, unknown>)
            : undefined;
    const confirmedScene = confirmed?.scene_type;
    const confirmedId = id(confirmed?.scene_id);
    const hasConfirmedScene =
        Boolean(confirmedId) &&
        (confirmedScene === "private" ||
            confirmedScene === "direct" ||
            confirmedScene === "group" ||
            confirmedScene === "channel");
    const scene = hasConfirmedScene
        ? confirmedScene
        : message.scene_type === "direct"
          ? "private"
          : message.scene_type;
    if (scene !== "private" && scene !== "direct" && scene !== "group" && scene !== "channel")
        return undefined;
    const sceneId = hasConfirmedScene ? confirmedId : id(message.scene_id);
    if (!sceneId) return undefined;
    const guildId =
        (hasConfirmedScene ? id(confirmed?.guild_id) : undefined) ?? id(message.guild_id);
    return {
        platform: bounded(platform, MAX_ID),
        accountId: bounded(accountId, MAX_ID),
        sceneType: scene,
        sceneId,
        ...(guildId ? { guildId } : {}),
        ...(id(sent.message_id) ? { messageId: id(sent.message_id) } : {}),
        senderId: bounded(accountId, MAX_ID),
        senderName: "我",
        direction: "outbound",
        text: textForSegments(message.message),
        time: Date.now(),
    };
}

/** 管理服务和受管网关共享的 SQLite 历史；WAL 支持单写多读与动态设置。 */
export class ChatHistoryStore {
    private readonly db: DatabaseSync;
    private readonly maintenanceTimer?: ReturnType<typeof setInterval>;
    private lastPrunedAt = 0;

    constructor(file: string, onMaintenanceError?: (error: unknown) => void) {
        mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
        this.db = new DatabaseSync(file);
        if (process.platform !== "win32") chmodSync(file, 0o600);
        this.db.exec("PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;");
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS chat_history_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                enabled INTEGER NOT NULL,
                retention_days INTEGER NOT NULL
            );
            INSERT OR IGNORE INTO chat_history_settings (id, enabled, retention_days) VALUES (1, 1, 30);
            CREATE TABLE IF NOT EXISTS chat_history_revision (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                revision TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS chat_messages (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                account_id TEXT NOT NULL,
                scene_type TEXT NOT NULL,
                scene_id TEXT NOT NULL,
                guild_id TEXT,
                message_id TEXT,
                sender_id TEXT NOT NULL,
                sender_name TEXT NOT NULL,
                direction TEXT NOT NULL,
                text TEXT NOT NULL,
                time INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_chat_conversation
                ON chat_messages (platform, account_id, scene_type, scene_id, id DESC);
            CREATE INDEX IF NOT EXISTS idx_chat_time ON chat_messages (time);
        `);
        this.db
            .prepare("INSERT OR IGNORE INTO chat_history_revision (id, revision) VALUES (1, ?)")
            .run(randomUUID());
        // 旧索引未区分服务器；在独占事务中升级，避免相同频道 ID 跨服务器时误去重。
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const version = this.db.prepare("PRAGMA user_version").get() as {
                user_version: number;
            };
            if (version.user_version < 2) {
                this.db.exec(`DROP INDEX IF EXISTS idx_chat_message_identity;
                    CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_message_identity_v2
                    ON chat_messages (platform, account_id, scene_type, scene_id,
                        COALESCE(guild_id, ''), message_id) WHERE message_id IS NOT NULL;
                    PRAGMA user_version = 2;`);
            }
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        this.prune(Date.now());
        if (onMaintenanceError) {
            this.maintenanceTimer = setInterval(() => {
                try {
                    this.prune(Date.now());
                } catch (error) {
                    onMaintenanceError(error);
                }
            }, 900_000);
            this.maintenanceTimer.unref();
        }
    }

    settings(): ControlChatHistorySettings {
        const row = this.db
            .prepare("SELECT enabled, retention_days FROM chat_history_settings WHERE id = 1")
            .get() as { enabled: number; retention_days: number } | undefined;
        return { enabled: row?.enabled === 1, retentionDays: row?.retention_days ?? 30 };
    }

    updateSettings(settings: ControlChatHistorySettings): ControlChatHistorySettings {
        if (
            typeof settings?.enabled !== "boolean" ||
            !Number.isInteger(settings.retentionDays) ||
            settings.retentionDays < 1 ||
            settings.retentionDays > 3650
        )
            throw new Error("聊天记录设置无效");
        this.db
            .prepare(
                "UPDATE chat_history_settings SET enabled = ?, retention_days = ? WHERE id = 1",
            )
            .run(settings.enabled ? 1 : 0, settings.retentionDays);
        this.prune(Date.now());
        return this.settings();
    }

    append(message: NewMessage): void {
        if (!this.settings().enabled) return;
        if (!message.text || !Number.isFinite(message.time)) return;
        const time = Math.min(Math.trunc(message.time), Date.now());
        this.db
            .prepare(
                `INSERT OR IGNORE INTO chat_messages
            (platform, account_id, scene_type, scene_id, guild_id, message_id,
             sender_id, sender_name, direction, text, time)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
                message.platform,
                message.accountId,
                message.sceneType,
                message.sceneId,
                message.guildId ?? null,
                message.messageId ?? null,
                message.senderId,
                message.senderName,
                message.direction,
                message.text,
                time,
            );
        // 平台自回显可能先于发送结果到达；同一消息最终按发出方向展示。
        if (message.direction === "outbound" && message.messageId) {
            this.db
                .prepare(
                    `UPDATE chat_messages SET direction = 'outbound', sender_id = ?,
                sender_name = ?, text = ? WHERE platform = ? AND account_id = ? AND scene_type = ?
                AND scene_id = ? AND COALESCE(guild_id, '') = ?
                AND message_id = ? AND direction = 'inbound'`,
                )
                .run(
                    message.senderId,
                    message.senderName,
                    message.text,
                    message.platform,
                    message.accountId,
                    message.sceneType,
                    message.sceneId,
                    message.guildId ?? "",
                    message.messageId,
                );
        }
        if (Date.now() - this.lastPrunedAt > 900_000) this.prune(Date.now());
    }

    history(query: ControlChatHistoryQuery): ControlChatMessage[] {
        return this.historyPage(query).messages;
    }

    historyPage(query: ControlChatHistoryQuery): ControlChatHistoryPage {
        if (Date.now() - this.lastPrunedAt > 900_000) this.prune(Date.now());
        this.db.exec("BEGIN");
        try {
            // 修订号与消息在同一个 SQLite 读快照中取得，避免清理同时发生时混用新旧状态。
            const revision = this.revision();
            const messages = this.readHistory(query);
            this.db.exec("COMMIT");
            return { messages, revision };
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    private revision(): string {
        const row = this.db
            .prepare("SELECT revision FROM chat_history_revision WHERE id = 1")
            .get() as {
            revision: string;
        };
        return row.revision;
    }

    private readHistory(query: ControlChatHistoryQuery): ControlChatMessage[] {
        const settings = this.settings();
        const cutoff = Date.now() - settings.retentionDays * DAY;
        const before = query.before ?? Number.MAX_SAFE_INTEGER;
        const rows = this.db
            .prepare(
                `SELECT id, platform, account_id, scene_type, scene_id,
            guild_id, message_id, sender_id, sender_name, direction, text, time
            FROM chat_messages WHERE platform = ? AND account_id = ? AND scene_type = ?
            AND scene_id = ? AND COALESCE(guild_id, '') = ? AND id < ?
            AND time >= ? ORDER BY id DESC LIMIT 50`,
            )
            .all(
                query.platform,
                query.accountId,
                query.sceneType,
                query.sceneId,
                query.guildId ?? "",
                before,
                cutoff,
            ) as Array<Record<string, string | number | null>>;
        return rows.reverse().map(messageFromRow);
    }

    conversations(platform: string, accountId: string, before?: number): ControlChatConversation[] {
        if (Date.now() - this.lastPrunedAt > 900_000) this.prune(Date.now());
        const cutoff = Date.now() - this.settings().retentionDays * DAY;
        const rows = this.db
            .prepare(
                `WITH latest AS (
                    SELECT MAX(id) AS id FROM chat_messages
                    WHERE platform = ? AND account_id = ? AND time >= ?
                    GROUP BY scene_type, scene_id, COALESCE(guild_id, '')
                )
                SELECT m.id, m.platform, m.account_id, m.scene_type, m.scene_id,
                    m.guild_id, m.message_id, m.sender_id, m.sender_name,
                    m.direction, m.text, m.time
                FROM latest JOIN chat_messages AS m ON m.id = latest.id
                WHERE m.id < ? ORDER BY m.id DESC LIMIT 51`,
            )
            .all(platform, accountId, cutoff, before ?? Number.MAX_SAFE_INTEGER) as Array<
            Record<string, string | number | null>
        >;
        return rows.map(row => {
            const latest = messageFromRow(row);
            return {
                sceneType: latest.sceneType,
                sceneId: latest.sceneId,
                ...(latest.guildId ? { guildId: latest.guildId } : {}),
                latest,
            };
        });
    }

    clear(): number {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const deleted = Number(this.db.prepare("DELETE FROM chat_messages").run().changes);
            if (deleted) this.bumpRevision();
            this.db.exec("COMMIT");
            return deleted;
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }

    close(): void {
        if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
        this.db.close();
    }

    private prune(now: number): void {
        const cutoff = now - this.settings().retentionDays * DAY;
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const deleted = Number(
                this.db.prepare("DELETE FROM chat_messages WHERE time < ?").run(cutoff).changes,
            );
            if (deleted) this.bumpRevision();
            this.db.exec("COMMIT");
        } catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
        this.lastPrunedAt = now;
    }

    private bumpRevision(): void {
        this.db
            .prepare("UPDATE chat_history_revision SET revision = ? WHERE id = 1")
            .run(randomUUID());
    }
}
