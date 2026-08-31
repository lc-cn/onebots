import { SqliteDB } from "onebots";
import type { TeamsConversationReference } from "./types.js";

interface ReferenceRow {
    key: string;
    account_id: string;
    conversation_id: string;
    reference: string;
    updated_at: number;
}

interface MessageRow {
    key: string;
    account_id: string;
    message_id: string;
    conversation_id: string;
    updated_at: number;
}

const REFERENCE_TABLE = "teams_conversation_references";
const MESSAGE_TABLE = "teams_message_contexts";

/** 将主动消息所需上下文持久化，避免进程重启后失去发送能力。 */
export class TeamsConversationStore {
    constructor(private readonly db: SqliteDB) {
        db.create(REFERENCE_TABLE, {
            key: SqliteDB.Column("TEXT", { primaryKey: true }),
            account_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            conversation_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            reference: SqliteDB.Column("TEXT", { notNull: true }),
            updated_at: SqliteDB.Column("INTEGER", { notNull: true }),
        });
        db.create(MESSAGE_TABLE, {
            key: SqliteDB.Column("TEXT", { primaryKey: true }),
            account_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            message_id: SqliteDB.Column("TEXT", { index: true, notNull: true }),
            conversation_id: SqliteDB.Column("TEXT", { notNull: true }),
            updated_at: SqliteDB.Column("INTEGER", { notNull: true }),
        });
    }

    getReference(
        accountId: string,
        conversationId: string,
    ): TeamsConversationReference | undefined {
        const [row] = this.db
            .select("reference")
            .from(REFERENCE_TABLE)
            .where({ key: this.key(accountId, conversationId) })
            .run() as Array<Pick<ReferenceRow, "reference">>;
        if (!row) return undefined;
        try {
            return JSON.parse(row.reference) as TeamsConversationReference;
        } catch {
            // 旧或损坏的单条缓存不能阻断账号启动；下次入站事件会覆盖它。
            return undefined;
        }
    }

    listReferences(accountId: string): TeamsConversationReference[] {
        const rows = this.db
            .select("reference")
            .from(REFERENCE_TABLE)
            .where({ account_id: accountId })
            .orderBy("updated_at", "DESC")
            .run() as Array<Pick<ReferenceRow, "reference">>;
        return rows.flatMap(row => {
            try {
                return [JSON.parse(row.reference) as TeamsConversationReference];
            } catch {
                return [];
            }
        });
    }

    saveReference(accountId: string, reference: TeamsConversationReference): void {
        const conversationId = reference.conversation.id;
        const row: ReferenceRow = {
            key: this.key(accountId, conversationId),
            account_id: accountId,
            conversation_id: conversationId,
            reference: JSON.stringify(reference),
            updated_at: Date.now(),
        };
        const [existing] = this.db
            .select("key")
            .from(REFERENCE_TABLE)
            .where({ key: row.key })
            .run();
        if (existing) {
            this.db
                .update(REFERENCE_TABLE)
                .set({ ...row })
                .where({ key: row.key })
                .run();
        } else {
            this.db
                .insert(REFERENCE_TABLE)
                .values({ ...row })
                .run();
        }
    }

    saveMessageContext(accountId: string, messageId: string, conversationId: string): void {
        if (!messageId || !conversationId) return;
        const key = this.key(accountId, messageId);
        const [existing] = this.db.select("key").from(MESSAGE_TABLE).where({ key }).run();
        const row: MessageRow = {
            key,
            account_id: accountId,
            message_id: messageId,
            conversation_id: conversationId,
            updated_at: Date.now(),
        };
        if (existing)
            this.db
                .update(MESSAGE_TABLE)
                .set({ ...row })
                .where({ key })
                .run();
        else
            this.db
                .insert(MESSAGE_TABLE)
                .values({ ...row })
                .run();
    }

    findConversationByMessage(accountId: string, messageId: string): string | undefined {
        const [row] = this.db
            .select("conversation_id")
            .from(MESSAGE_TABLE)
            .where({ key: this.key(accountId, messageId) })
            .run() as Array<Pick<MessageRow, "conversation_id">>;
        return row?.conversation_id;
    }

    private key(accountId: string, value: string): string {
        // SQLite 查询器当前使用 SQL 字面量，复合键必须保持为可打印文本，不能使用 NUL 分隔。
        return `${encodeURIComponent(accountId)}:${encodeURIComponent(value)}`;
    }
}
