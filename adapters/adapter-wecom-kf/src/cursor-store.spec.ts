import { rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { loadKfCursors, persistKfCursors } from "./cursor-store.js";

const temporaryFiles: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryFiles.splice(0).map(path => rm(path, { force: true })));
});

describe("微信客服同步游标存储", () => {
    it("原子写入后可完整读取多个客服账号的游标", async () => {
        const path = temporaryPath();
        const cursors = new Map([
            ["wk-one", "cursor-one"],
            ["wk-two", "cursor-two"],
        ]);

        await persistKfCursors(path, cursors);

        await expect(loadKfCursors(path)).resolves.toEqual(cursors);
    });

    it("拒绝损坏或类型不正确的游标文件", async () => {
        const path = temporaryPath();
        await writeFile(path, '{"wk-one":42}', "utf8");

        await expect(loadKfCursors(path)).rejects.toMatchObject({
            code: "WECOM_KF_CURSOR_INVALID",
            path,
        });
    });
});

function temporaryPath(): string {
    const path = `/tmp/onebots-wecom-kf-store-${process.pid}-${Date.now()}-${temporaryFiles.length}.json`;
    temporaryFiles.push(path);
    return path;
}
