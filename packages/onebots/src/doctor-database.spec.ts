import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { inspectConfiguredDatabase, inspectDatabaseFile } from "./doctor-database.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("doctor database target", () => {
    it("resolves the default database below data and accepts a creatable target", () => {
        const dataDirectory = createDirectory();

        expect(inspectConfiguredDatabase(dataDirectory, {})).toEqual({
            path: path.join(dataDirectory, "onebots.db"),
            check: {
                name: "database",
                level: "ok",
                message: `数据库文件可创建: ${path.join(dataDirectory, "onebots.db")}`,
            },
        });
    });

    it("validates an existing database file together with its parent directory", () => {
        const dataDirectory = createDirectory();
        const databasePath = path.join(dataDirectory, "runtime.db");
        fs.writeFileSync(databasePath, "");

        expect(inspectDatabaseFile(databasePath)).toEqual({
            name: "database",
            level: "ok",
            message: `数据库文件及其父目录可写: ${databasePath}`,
        });
    });

    it("rejects an absolute database target below a colliding parent file", () => {
        const dataDirectory = createDirectory();
        const collision = path.join(dataDirectory, "state");
        const databasePath = path.join(collision, "runtime.db");
        fs.writeFileSync(collision, "not a directory");

        expect(inspectConfiguredDatabase(dataDirectory, { database: databasePath })).toEqual({
            path: databasePath,
            check: {
                name: "database",
                level: "error",
                message: `数据库父路径不是目录: ${collision}`,
            },
        });
    });

    it("keeps an invalid database value out of report target metadata", () => {
        const dataDirectory = createDirectory();

        expect(inspectConfiguredDatabase(dataDirectory, { database: "" })).toEqual({
            path: null,
            check: {
                name: "database",
                level: "error",
                message: "数据库路径配置无效: database 必须是非空字符串",
            },
        });
    });
});

function createDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-database-"));
    temporaryDirectories.push(directory);
    return directory;
}
