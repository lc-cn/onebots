import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    assertPublicStaticRevisionPrecondition,
    capturePublicStaticSnapshot,
    EXPECTED_PUBLIC_STATIC_REVISION_HEADER,
    PublicStaticRevisionMismatchError,
} from "./public-static-snapshot.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function temporaryDirectory(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-static-snapshot-"));
    directories.push(directory);
    return directory;
}

describe("public static snapshot", () => {
    it("只列出常规文件并让同名原子替换改变修订", () => {
        const root = temporaryDirectory();
        fs.writeFileSync(path.join(root, "asset.txt"), "before");
        fs.mkdirSync(path.join(root, "nested"));
        const before = capturePublicStaticSnapshot(root);

        const replacement = path.join(root, ".replacement");
        fs.writeFileSync(replacement, "after");
        fs.renameSync(replacement, path.join(root, "asset.txt"));
        const after = capturePublicStaticSnapshot(root);

        expect(before.files).toEqual(["asset.txt"]);
        expect(after.files).toEqual(["asset.txt"]);
        expect(after.revision).toMatch(/^sha256:[a-f0-9]{64}$/u);
        expect(after.revision).not.toBe(before.revision);
    });

    it("绑定静态根并区分畸形与过期前置条件", () => {
        const first = temporaryDirectory();
        const second = temporaryDirectory();
        fs.writeFileSync(path.join(first, "asset.txt"), "same");
        fs.writeFileSync(path.join(second, "asset.txt"), "same");
        const revision = capturePublicStaticSnapshot(first).revision;
        const context = {
            get: (name: string) =>
                name === EXPECTED_PUBLIC_STATIC_REVISION_HEADER ? revision : "",
        };

        expect(() =>
            assertPublicStaticRevisionPrecondition(context, first, "静态文件删除"),
        ).not.toThrow();
        expect(() =>
            assertPublicStaticRevisionPrecondition(context, second, "静态文件删除"),
        ).toThrow(PublicStaticRevisionMismatchError);
        expect(() =>
            assertPublicStaticRevisionPrecondition({ get: () => "invalid" }, first, "静态文件删除"),
        ).toThrow("静态文件删除请求的静态目录修订号无效");
    });
});
