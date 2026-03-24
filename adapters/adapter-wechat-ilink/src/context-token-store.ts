/**
 * iLink context_token：按 OneBots 账号 + 对端 peer 存 SQLite，会话 JSON 不再写入 contextTokens。
 */
import type { SqliteDB } from "onebots";

/** 表名（与 Adapter 其它表并列于 onebots.db） */
export const WECHAT_ILINK_CONTEXT_TOKEN_TABLE = "wechat_ilink_context_token";

/**
 * 读写 context_token。
 * - `accountKey`：OneBots 配置里的 `account_id`
 * - `ilinkBotId`：会话中的机器人 `accountId`（写入时落库便于排查；读取时按 accountKey+peer 取，便于 token 复用）
 */
export interface IlinkContextTokenStore {
    get(accountKey: string, ilinkBotId: string, peerId: string): string | undefined;
    set(accountKey: string, ilinkBotId: string, peerId: string, token: string): void;
}

/** 确保表存在（复合主键） */
export function ensureWechatIlinkContextTokenTable(db: SqliteDB): void {
    db.execSQL(`CREATE TABLE IF NOT EXISTS ${WECHAT_ILINK_CONTEXT_TOKEN_TABLE} (
        account_key TEXT NOT NULL,
        peer_id TEXT NOT NULL,
        ilink_bot_id TEXT NOT NULL,
        context_token TEXT NOT NULL,
        updated_at TEXT,
        PRIMARY KEY (account_key, peer_id)
    )`);
}

export class SqliteIlinkContextTokenStore implements IlinkContextTokenStore {
    constructor(private readonly db: SqliteDB) {}

    get(accountKey: string, _ilinkBotId: string, peerId: string): string | undefined {
        const [row] = this.db
            .select("context_token")
            .from(WECHAT_ILINK_CONTEXT_TOKEN_TABLE)
            .where({ account_key: accountKey, peer_id: peerId })
            .run() as { context_token: string }[];
        return row?.context_token;
    }

    set(accountKey: string, ilinkBotId: string, peerId: string, token: string): void {
        const now = new Date().toISOString();
        const existing = this.db
            .select("peer_id")
            .from(WECHAT_ILINK_CONTEXT_TOKEN_TABLE)
            .where({ account_key: accountKey, peer_id: peerId })
            .run() as { peer_id: string }[];
        if (existing.length > 0) {
            this.db
                .update(WECHAT_ILINK_CONTEXT_TOKEN_TABLE)
                .set({
                    ilink_bot_id: ilinkBotId,
                    context_token: token,
                    updated_at: now,
                })
                .where({ account_key: accountKey, peer_id: peerId })
                .run();
        } else {
            this.db
                .insert(WECHAT_ILINK_CONTEXT_TOKEN_TABLE)
                .values({
                    account_key: accountKey,
                    peer_id: peerId,
                    ilink_bot_id: ilinkBotId,
                    context_token: token,
                    updated_at: now,
                })
                .run();
        }
    }
}
