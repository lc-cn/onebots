/**
 * 适配器 ID 管理单元测试
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTableName, createId } from "../adapter-id-manager.js";
import { SqliteDB } from "../db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("buildTableName", () => {
    it("普通平台名保持不变", () => {
        expect(buildTableName("qq")).toBe("id_map_qq");
        expect(buildTableName("wechat")).toBe("id_map_wechat");
        expect(buildTableName("discord")).toBe("id_map_discord");
    });

    it("含连字符的平台名转为下划线", () => {
        expect(buildTableName("wechat-clawbot")).toBe("id_map_wechat_clawbot");
        expect(buildTableName("wecom-kf")).toBe("id_map_wecom_kf");
    });

    it("特殊字符被过滤", () => {
        expect(buildTableName("test.platform")).toBe("id_map_test_platform");
    });
});

describe("createId 平台原始类型契约", () => {
    it("数字 ID 直接保留，字符串 ID 才分配唯一数字映射", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-id-contract-"));
        temporaryDirectories.push(directory);
        const database = new SqliteDB(path.join(directory, "id-map.db"));
        const tableName = "id_map_contract";
        database.create(tableName, {
            string: SqliteDB.Column("TEXT"),
            number: SqliteDB.Column("INTEGER", { unique: true }),
            source: SqliteDB.Column("TEXT"),
        });
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        expect(createId(123456, tableName, database)).toEqual({
            number: 123456,
            string: "123456",
            source: 123456,
        });
        expect(createId("123456", tableName, database)).toEqual({
            number: 50_000_000_000,
            string: "123456",
            source: "123456",
        });
        expect(createId("123456", tableName, database).number).toBe(50_000_000_000);
        database.close();
    });
});
