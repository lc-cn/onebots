import { CommonTypes } from "./types.js";
import { SqliteDB } from "./db.js";

/**
 * 适配器 ID 管理
 * 提供平台 ID ↔ 框架统一数字 ID 的双向映射
 *
 * 使用方式：将本 mixin 应用到 Adapter 子类，
 * 或通过 Adapter.prototype 挂载
 */

/**
 * 构建 id_map 表名
 * 平台名可能含 `-`（如 wechat-clawbot），不能直接拼进 SQL，需规范为合法标识符。
 */
export function buildTableName(platform: string): string {
    const safe = String(platform).replace(/[^a-zA-Z0-9_]/g, "_");
    return `id_map_${safe}`;
}

/**
 * 创建 ID
 * 将平台原始 ID（string / number）映射为框架统一的 CommonTypes.Id
 * - number 类型直接转换
 * - string 类型先查 id_map 表，不存在则分配随机数
 */
export function createId(
    id: string | number,
    tableName: string,
    db: SqliteDB,
    _retries: number = 0
): CommonTypes.Id {
    if (id === undefined || id === null) {
        throw new Error('createId: id 不能为 undefined 或 null');
    }
    if (_retries > 10) {
        throw new Error('createId: 超过最大重试次数，无法生成唯一 ID');
    }
    if (typeof id === "number") return { string: id.toString(), number: id, source: id };
    const [existData] = db.select('*').from(tableName).where({
        string: id
    }).run();
    if (existData) return existData as CommonTypes.Id;
    const randomNum = Math.floor(Math.random() * 100000000000);
    const [checkExist] = db.select('*').from(tableName).where({
        number: randomNum
    }).run();

    if (checkExist) return createId(id, tableName, db, _retries + 1);
    const newId: CommonTypes.Id = {
        string: id,
        number: randomNum,
        source: id
    };
    db.insert(tableName).values(newId).run();
    return newId;
}

/**
 * 将 string / number / 已是框架层的 Id 归一到当前适配器的 Id。
 * - 已带有 string+number 的 Id：原样返回（避免被当成 string 键查错）。
 * - string / number：查 id_map，无则 createId。
 */
export function resolveId(
    id: string | number | CommonTypes.Id,
    tableName: string,
    db: SqliteDB
): CommonTypes.Id {
    if (
        typeof id === "object" &&
        id !== null &&
        typeof (id as CommonTypes.Id).string === "string" &&
        typeof (id as CommonTypes.Id).number === "number"
    ) {
        return id as CommonTypes.Id;
    }
    const primitive = id as string | number;
    const [dbRecord] = db
        .select("*")
        .from(tableName)
        .where({
            [typeof primitive === "number" ? "number" : "string"]: primitive,
        })
        .run();
    if (dbRecord) return dbRecord as CommonTypes.Id;
    return createId(primitive, tableName, db);
}

/**
 * 将协议传入的 scene_id / user_id 归一为 CommonTypes.Id。
 * - 事件侧经 createId 上报的 Id：直接可用，.string / .source 存平台原始标识。
 * - Milky 等若传入 JSON 原始 string/number：需 resolveId 查表或建档，才能与 passiveReply 等场景用的 openid 一致。
 */
export function coerceId(
    value: CommonTypes.Id | string | number,
    tableName: string,
    db: SqliteDB
): CommonTypes.Id {
    return resolveId(value as string | number | CommonTypes.Id, tableName, db);
}
