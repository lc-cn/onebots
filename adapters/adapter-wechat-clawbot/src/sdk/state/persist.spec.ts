import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { JsonFileCredentialStore } from "./persist.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryRoots
            .splice(0)
            .map(directory => fs.rm(directory, { recursive: true, force: true })),
    );
});

async function temporaryStore(): Promise<{ store: JsonFileCredentialStore; file: string }> {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "onebots-clawbot-session-"));
    temporaryRoots.push(directory);
    const file = path.join(directory, "nested", "session.json");
    return { store: new JsonFileCredentialStore(file), file };
}

describe("JsonFileCredentialStore", () => {
    it("以原子写入和仅所有者权限持久化凭证", async () => {
        const { store, file } = await temporaryStore();
        const session = {
            token: "token",
            accountId: "bot",
            baseUrl: "https://example.test",
            cdnBaseUrl: "https://cdn.example.test",
        };
        await store.save(session);
        expect(await store.load()).toEqual(session);
        expect((await fs.stat(file)).mode & 0o777).toBe(0o600);
        expect(
            (await fs.readdir(path.dirname(file))).filter(name => name.endsWith(".tmp")),
        ).toEqual([]);
    });

    it("只把不存在视为无会话，损坏文件返回结构化错误", async () => {
        const { store, file } = await temporaryStore();
        await expect(store.load()).resolves.toBeNull();
        await fs.mkdir(path.dirname(file), { recursive: true });
        await fs.writeFile(file, "not-json", "utf8");
        await expect(store.load()).rejects.toMatchObject({ code: "SESSION_INVALID_JSON" });
        await fs.writeFile(file, JSON.stringify({ token: "only-token" }), "utf8");
        await expect(store.load()).rejects.toMatchObject({ code: "SESSION_INVALID" });
    });
});
