import fs from "node:fs/promises";
import path from "node:path";
import type { CredentialBlob, SessionStore } from "../protocol/chat-event.js";

export class MemoryCredentialStore implements SessionStore {
    private snapshot: CredentialBlob | null;

    constructor(initial?: CredentialBlob | null) {
        this.snapshot = initial ?? null;
    }

    async load(): Promise<CredentialBlob | null> {
        return this.snapshot
            ? { ...this.snapshot, contextTokens: { ...(this.snapshot.contextTokens ?? {}) } }
            : null;
    }

    async save(session: CredentialBlob): Promise<void> {
        this.snapshot = { ...session, contextTokens: { ...(session.contextTokens ?? {}) } };
    }

    async clear(): Promise<void> {
        this.snapshot = null;
    }
}

export class JsonFileCredentialStore implements SessionStore {
    readonly absolutePath: string;

    constructor(filePath: string) {
        this.absolutePath = path.resolve(filePath);
    }

    async load(): Promise<CredentialBlob | null> {
        try {
            const raw = await fs.readFile(this.absolutePath, "utf-8");
            return JSON.parse(raw) as CredentialBlob;
        } catch {
            return null;
        }
    }

    async save(session: CredentialBlob): Promise<void> {
        await fs.mkdir(path.dirname(this.absolutePath), { recursive: true });
        await fs.writeFile(this.absolutePath, JSON.stringify(session, null, 2), "utf-8");
    }

    async clear(): Promise<void> {
        try {
            await fs.unlink(this.absolutePath);
        } catch {
            // ignore
        }
    }
}
