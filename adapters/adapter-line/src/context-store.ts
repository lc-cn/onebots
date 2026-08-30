import { SqliteDB } from "onebots";
import type { LineChatContext } from "./types.js";

interface ChatRow {
    key: string;
    account_id: string;
    chat_id: string;
    chat_type: "group" | "room";
    name: string;
    updated_at: number;
}

interface EventRow {
    key: string;
    account_id: string;
    event_id: string;
    processed_at: number;
}

interface MessageTokenRow {
    key: string;
    account_id: string;
    message_id: string;
    quote_token: string;
    mark_as_read_token: string;
    updated_at: number;
}

export interface LineMessageTokens {
    quoteToken?: string;
    markAsReadToken?: string;
}

const CHAT_TABLE = "line_chat_contexts";
const EVENT_TABLE = "line_processed_webhooks";
const MESSAGE_TOKEN_TABLE = "line_message_tokens";

/** 持久化 Webhook 已知聊天，补足 LINE 没有“列出机器人所在聊天”接口的空白。 */
export class LineContextStore {
    private eventSequence = 0;

    constructor(private readonly db: SqliteDB) {
        db.create(CHAT_TABLE, {
            key: SqliteDB.Column("TEXT", { primaryKey: true }),
            account_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            chat_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            chat_type: SqliteDB.Column("TEXT", { notNull: true }),
            name: SqliteDB.Column("TEXT", { notNull: true }),
            updated_at: SqliteDB.Column("INTEGER", { notNull: true }),
        });
        db.create(EVENT_TABLE, {
            key: SqliteDB.Column("TEXT", { primaryKey: true }),
            account_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            event_id: SqliteDB.Column("TEXT", { notNull: true }),
            processed_at: SqliteDB.Column("INTEGER", { index: true, notNull: true }),
        });
        db.create(MESSAGE_TOKEN_TABLE, {
            key: SqliteDB.Column("TEXT", { primaryKey: true }),
            account_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            message_id: SqliteDB.Column("TEXT", { notNull: true }),
            quote_token: SqliteDB.Column("TEXT", { notNull: true }),
            mark_as_read_token: SqliteDB.Column("TEXT", { notNull: true }),
            updated_at: SqliteDB.Column("INTEGER", { index: true, notNull: true }),
        });
    }

    save(accountId: string, chat: Omit<LineChatContext, "updated_at">): void {
        const key = this.key(accountId, chat.id);
        const existing = this.get(accountId, chat.id);
        const row: ChatRow = {
            key,
            account_id: accountId,
            chat_id: chat.id,
            chat_type: chat.type,
            name: chat.name ?? existing?.name ?? "",
            updated_at: Date.now(),
        };
        if (existing) {
            this.db
                .update(CHAT_TABLE)
                .set({ ...row })
                .where({ key })
                .run();
        } else {
            this.db
                .insert(CHAT_TABLE)
                .values({ ...row })
                .run();
        }
    }

    get(accountId: string, chatId: string): LineChatContext | undefined {
        const [row] = this.db
            .select("chat_id", "chat_type", "name", "updated_at")
            .from(CHAT_TABLE)
            .where({ key: this.key(accountId, chatId) })
            .run() as Array<Pick<ChatRow, "chat_id" | "chat_type" | "name" | "updated_at">>;
        return row ? this.toContext(row) : undefined;
    }

    list(accountId: string): LineChatContext[] {
        const rows = this.db
            .select("chat_id", "chat_type", "name", "updated_at")
            .from(CHAT_TABLE)
            .where({ account_id: accountId })
            .orderBy("updated_at", "DESC")
            .run() as Array<Pick<ChatRow, "chat_id" | "chat_type" | "name" | "updated_at">>;
        return rows.map(row => this.toContext(row));
    }

    remove(accountId: string, chatId: string): void {
        this.db
            .delete(CHAT_TABLE)
            .where({ key: this.key(accountId, chatId) })
            .run();
    }

    hasEvent(accountId: string, eventId: string): boolean {
        const key = this.key(accountId, eventId);
        const [existing] = this.db.select("key").from(EVENT_TABLE).where({ key }).run();
        return Boolean(existing);
    }

    /** 在事件成功分发后记录 ID，并按账号裁剪持久化去重窗口。 */
    saveEvent(accountId: string, eventId: string, limit: number): void {
        const key = this.key(accountId, eventId);
        if (this.hasEvent(accountId, eventId)) return;
        const row: EventRow = {
            key,
            account_id: accountId,
            event_id: eventId,
            processed_at: Date.now() * 1_000 + (this.eventSequence++ % 1_000),
        };
        this.db
            .insert(EVENT_TABLE)
            .values({ ...row })
            .run();
        const rows = this.db
            .select("key")
            .from(EVENT_TABLE)
            .where({ account_id: accountId })
            .orderBy("processed_at", "DESC")
            .run() as Array<Pick<EventRow, "key">>;
        for (const expired of rows.slice(Math.max(100, limit))) {
            this.db.delete(EVENT_TABLE).where({ key: expired.key }).run();
        }
    }

    /** 持久化无过期时间的 LINE quote/read token，并按账号限制存储规模。 */
    saveMessageTokens(
        accountId: string,
        messageId: string,
        tokens: LineMessageTokens,
        limit: number,
    ): void {
        const existing = this.getMessageTokens(accountId, messageId);
        const quoteToken = tokens.quoteToken ?? existing?.quoteToken;
        const markAsReadToken = tokens.markAsReadToken ?? existing?.markAsReadToken;
        if (!quoteToken && !markAsReadToken) return;
        const key = this.key(accountId, messageId);
        const row: MessageTokenRow = {
            key,
            account_id: accountId,
            message_id: messageId,
            quote_token: quoteToken || "",
            mark_as_read_token: markAsReadToken || "",
            updated_at: Date.now() * 1_000 + (this.eventSequence++ % 1_000),
        };
        if (existing) {
            this.db
                .update(MESSAGE_TOKEN_TABLE)
                .set({ ...row })
                .where({ key })
                .run();
        } else {
            this.db
                .insert(MESSAGE_TOKEN_TABLE)
                .values({ ...row })
                .run();
        }
        const rows = this.db
            .select("key")
            .from(MESSAGE_TOKEN_TABLE)
            .where({ account_id: accountId })
            .orderBy("updated_at", "DESC")
            .run() as Array<Pick<MessageTokenRow, "key">>;
        for (const expired of rows.slice(Math.max(100, limit))) {
            this.db.delete(MESSAGE_TOKEN_TABLE).where({ key: expired.key }).run();
        }
    }

    getMessageTokens(accountId: string, messageId: string): LineMessageTokens | undefined {
        const [row] = this.db
            .select("quote_token", "mark_as_read_token")
            .from(MESSAGE_TOKEN_TABLE)
            .where({ key: this.key(accountId, messageId) })
            .run() as Array<Pick<MessageTokenRow, "quote_token" | "mark_as_read_token">>;
        if (!row) return undefined;
        return {
            quoteToken: row.quote_token || undefined,
            markAsReadToken: row.mark_as_read_token || undefined,
        };
    }

    private toContext(
        row: Pick<ChatRow, "chat_id" | "chat_type" | "name" | "updated_at">,
    ): LineChatContext {
        return {
            id: row.chat_id,
            type: row.chat_type,
            name: row.name || undefined,
            updated_at: row.updated_at,
        };
    }

    private key(accountId: string, chatId: string): string {
        return `${encodeURIComponent(accountId)}:${encodeURIComponent(chatId)}`;
    }
}
