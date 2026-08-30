import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { KfCursorState } from "./cursor-state.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
    await Promise.all(
        temporaryDirectories.splice(0).map(path => rm(path, { recursive: true, force: true })),
    );
});

describe("KfCursorState", () => {
    it("串行合并不同客服账号的并发提交", async () => {
        const directory = await temporaryDirectory();
        const path = join(directory, "cursors.json");
        const state = new KfCursorState(path);
        await state.load();

        await Promise.all([state.commit("wk-one", "c1"), state.commit("wk-two", "c2")]);

        expect(JSON.parse(await readFile(path, "utf8"))).toEqual({
            "wk-one": "c1",
            "wk-two": "c2",
        });
    });

    it("持久化失败时不提前修改内存游标", async () => {
        const directory = await temporaryDirectory();
        const state = new KfCursorState(directory);
        await state.load().catch(() => undefined);

        await expect(state.commit("wk-one", "uncommitted")).rejects.toMatchObject({
            code: "WECOM_KF_CURSOR_WRITE_ERROR",
        });
        expect(state.get("wk-one")).toBe("");
    });
});

async function temporaryDirectory(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), "onebots-wecom-kf-state-"));
    temporaryDirectories.push(directory);
    return directory;
}
