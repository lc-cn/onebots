import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteDB } from "./db.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.runIf(process.platform !== "win32")("SQLite storage permissions", () => {
    it("creates nested database storage with owner-only directory and file modes", () => {
        const root = createDirectory();
        const directory = path.join(root, "private", "state");
        const databasePath = path.join(directory, "runtime.db");

        const database = new SqliteDB(databasePath);
        database.close();

        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
        expect(fs.statSync(databasePath).mode & 0o777).toBe(0o600);
    });

    it("tightens an existing database before opening it", () => {
        const root = createDirectory();
        const databasePath = path.join(root, "runtime.db");
        fs.writeFileSync(databasePath, "", { mode: 0o644 });
        fs.chmodSync(databasePath, 0o644);

        const database = new SqliteDB(databasePath);
        database.close();

        expect(fs.statSync(databasePath).mode & 0o777).toBe(0o600);
    });
});

function createDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-database-mode-"));
    temporaryDirectories.push(directory);
    return directory;
}
