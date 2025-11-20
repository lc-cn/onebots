import { DatabaseSync } from "node:sqlite";
import * as fs from "fs";
import * as path from "path";
import { Dict } from "@zhinjs/shared";

/**
 * SQLite-based database implementation to replace JsonDB
 * Uses Node.js built-in SQLite support (node:sqlite)
 */
export class SqliteDB {
    private db: DatabaseSync;

    constructor(private readonly filePath: string) {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        
        // Ensure file has .db extension
        if (!this.filePath.endsWith(".db")) this.filePath = this.filePath + ".db";
        
        // Open or create database
        this.db = new DatabaseSync(this.filePath);
        this.init();
    }

    private init() {
        // Create key-value store table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS kv_store (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL,
                type TEXT NOT NULL
            )
        `);

        // Create index for faster lookups
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_key ON kv_store(key)
        `);
    }

    /**
     * Get value by route/key
     */
    get<T>(route: string, initialValue?: T): T | undefined {
        const stmt = this.db.prepare("SELECT value, type FROM kv_store WHERE key = ?");
        const row = stmt.get(route) as { value: string; type: string } | undefined;

        if (row) {
            return this.deserialize(row.value, row.type) as T;
        }

        if (initialValue !== undefined) {
            this.set(route, initialValue);
        }

        return initialValue;
    }

    /**
     * Set value by route/key
     */
    set<T>(route: string, data: T): T {
        const { value, type } = this.serialize(data);
        
        const stmt = this.db.prepare(`
            INSERT OR REPLACE INTO kv_store (key, value, type)
            VALUES (?, ?, ?)
        `);
        
        stmt.run(route, value, type);
        return data;
    }

    /**
     * Delete value by route/key
     */
    delete(route: string): boolean {
        const stmt = this.db.prepare("DELETE FROM kv_store WHERE key = ?");
        const result = stmt.run(route);
        return result.changes > 0;
    }

    /**
     * Get array from storage
     */
    private getArray<T>(route: string): T[] {
        const arr = this.get<T[]>(route, []);
        if (!Array.isArray(arr)) {
            throw new TypeError(`data ${route} is not an Array`);
        }
        return arr;
    }

    /**
     * Find index in array
     */
    findIndex<T>(route: string, predicate: (value: T, index: number, obj: T[]) => unknown): number {
        const arr = this.getArray<T>(route);
        return arr.findIndex(predicate);
    }

    /**
     * Get index of item in array
     */
    indexOf<T>(route: string, item: T): number {
        return this.findIndex<T>(route, value => value === item);
    }

    /**
     * Add items to beginning of array
     */
    unshift<T>(route: string, ...data: T[]): number {
        const arr = this.getArray<T>(route);
        const result = arr.unshift(...data);
        this.set(route, arr);
        return result;
    }

    /**
     * Remove and return first item from array
     */
    shift<T>(route: string): T | undefined {
        const arr = this.getArray<T>(route);
        const result = arr.shift();
        this.set(route, arr);
        return result;
    }

    /**
     * Add items to end of array
     */
    push<T>(route: string, ...data: T[]): number {
        const arr = this.getArray<T>(route);
        const result = arr.push(...data);
        this.set(route, arr);
        return result;
    }

    /**
     * Remove and return last item from array
     */
    pop<T>(route: string): T | undefined {
        const arr = this.getArray<T>(route);
        const result = arr.pop();
        this.set(route, arr);
        return result;
    }

    /**
     * Splice array
     */
    splice<T>(route: string, index: number = 0, deleteCount: number = 0, ...data: T[]): T[] {
        const arr = this.getArray<T>(route);
        const result = arr.splice(index, deleteCount, ...data);
        this.set(route, arr);
        return result;
    }

    /**
     * Find item in array
     */
    find<T>(route: string, callback: (item: T) => boolean): T | undefined {
        return this.getArray<T>(route).find(callback);
    }

    /**
     * Filter array
     */
    filter<T>(route: string, callback: (item: T) => boolean): T[] {
        return this.getArray<T>(route).filter(callback);
    }

    /**
     * Close database connection
     */
    close(): void {
        this.db.close();
    }

    /**
     * Serialize data for storage
     */
    private serialize(data: any): { value: string; type: string } {
        let type = typeof data;
        let value: string;

        if (data === null) {
            type = "null";
            value = "";
        } else if (Array.isArray(data)) {
            type = "array";
            value = JSON.stringify(data);
        } else if (type === "object") {
            type = "object";
            value = JSON.stringify(data);
        } else if (type === "boolean") {
            value = data ? "1" : "0";
        } else if (type === "number") {
            value = data.toString();
        } else if (type === "bigint") {
            type = "bigint";
            value = data.toString();
        } else {
            value = String(data);
        }

        return { value, type };
    }

    /**
     * Deserialize data from storage
     */
    private deserialize(value: string, type: string): any {
        switch (type) {
            case "null":
                return null;
            case "array":
            case "object":
                return JSON.parse(value);
            case "boolean":
                return value === "1";
            case "number":
                return Number(value);
            case "bigint":
                return BigInt(value);
            default:
                return value;
        }
    }
}
