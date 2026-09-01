import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    inspectConfiguredDatabase,
    inspectDatabase,
    inspectDatabaseFile,
} from "./doctor-database.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("doctor database target", () => {
    it("resolves the default database below data and accepts a creatable target", () => {
        const dataDirectory = createDirectory();
        const databasePath = path.join(dataDirectory, "onebots.db");

        expect(inspectConfiguredDatabase(dataDirectory, {})).toEqual({
            path: databasePath,
            checks: [
                {
                    name: "database",
                    level: "ok",
                    message: `数据库文件可创建: ${databasePath}`,
                },
                ...(process.platform === "win32"
                    ? []
                    : [
                          {
                              name: "database-dir-mode",
                              level: "ok" as const,
                              message: "数据库目录权限 700 不允许组或其他用户替换数据库路径",
                          },
                      ]),
            ],
        });
    });

    it("validates an existing database file together with its parent directory", () => {
        const dataDirectory = createDirectory();
        const databasePath = path.join(dataDirectory, "runtime.db");
        fs.writeFileSync(databasePath, "", { mode: 0o600 });
        fs.chmodSync(databasePath, 0o600);

        expect(inspectDatabaseFile(databasePath)).toEqual({
            name: "database",
            level: "ok",
            message: `数据库文件及其父目录可写: ${databasePath}`,
        });
    });

    it.runIf(process.platform !== "win32")(
        "reports private database file and directory permissions separately",
        () => {
            const dataDirectory = createDirectory();
            const databasePath = path.join(dataDirectory, "runtime.db");
            fs.writeFileSync(databasePath, "", { mode: 0o600 });
            fs.chmodSync(databasePath, 0o600);

            expect(inspectDatabase(databasePath)).toEqual([
                {
                    name: "database",
                    level: "ok",
                    message: `数据库文件及其父目录可写: ${databasePath}`,
                },
                {
                    name: "database-mode",
                    level: "ok",
                    message: "数据库文件权限 600 未向组或其他用户开放",
                },
                {
                    name: "database-dir-mode",
                    level: "ok",
                    message: "数据库目录权限 700 不允许组或其他用户替换数据库路径",
                },
            ]);
        },
    );

    it.runIf(process.platform !== "win32")(
        "rejects a database file readable by other users",
        () => {
            const dataDirectory = createDirectory();
            const databasePath = path.join(dataDirectory, "runtime.db");
            fs.writeFileSync(databasePath, "", { mode: 0o644 });
            fs.chmodSync(databasePath, 0o644);

            expect(inspectDatabase(databasePath)).toContainEqual({
                name: "database-mode",
                level: "error",
                message:
                    "数据库文件权限 644 允许其他用户访问或同组用户修改；请由文件所有者收紧为 0600",
            });
            expect(fs.statSync(databasePath).mode & 0o777).toBe(0o644);
        },
    );

    it.runIf(process.platform !== "win32")(
        "rejects a database directory that permits path replacement",
        () => {
            const dataDirectory = createDirectory();
            const databasePath = path.join(dataDirectory, "runtime.db");
            fs.writeFileSync(databasePath, "", { mode: 0o600 });
            fs.chmodSync(dataDirectory, 0o770);

            expect(inspectDatabase(databasePath)).toContainEqual({
                name: "database-dir-mode",
                level: "error",
                message:
                    "数据库目录权限 770 允许组或其他用户替换数据库路径；请由目录所有者移除对应写权限",
            });
        },
    );

    it("rejects an absolute database target below a colliding parent file", () => {
        const dataDirectory = createDirectory();
        const collision = path.join(dataDirectory, "state");
        const databasePath = path.join(collision, "runtime.db");
        fs.writeFileSync(collision, "not a directory");

        expect(inspectConfiguredDatabase(dataDirectory, { database: databasePath })).toEqual({
            path: databasePath,
            checks: [
                {
                    name: "database",
                    level: "error",
                    message: `数据库父路径不是目录: ${collision}`,
                },
            ],
        });
    });

    it("keeps an invalid database value out of report target metadata", () => {
        const dataDirectory = createDirectory();

        expect(inspectConfiguredDatabase(dataDirectory, { database: "" })).toEqual({
            path: null,
            checks: [
                {
                    name: "database",
                    level: "error",
                    message: "数据库路径配置无效: database 必须是非空字符串",
                },
            ],
        });
    });
});

function createDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-database-"));
    temporaryDirectories.push(directory);
    return directory;
}
