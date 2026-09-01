import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePublicStaticRoot } from "./public-static-root.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function createFixture(): { configDir: string; logger: { warn: ReturnType<typeof vi.fn> } } {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-public-root-"));
    temporaryDirectories.push(directory);
    const configDir = path.join(directory, "config");
    fs.mkdirSync(configDir);
    return { configDir, logger: { warn: vi.fn() } };
}

describe("public static root", () => {
    it("创建并返回配置目录内的实际静态目录", () => {
        const { configDir, logger } = createFixture();

        const result = resolvePublicStaticRoot(configDir, "public", logger as never);

        expect(result).toBe(fs.realpathSync(path.join(configDir, "public")));
        expect(logger.warn).not.toHaveBeenCalled();
    });

    it.runIf(process.platform !== "win32")("拒绝通过相对符号链接逃出配置目录", () => {
        const { configDir, logger } = createFixture();
        const external = path.join(path.dirname(configDir), "external");
        fs.mkdirSync(external);
        fs.symlinkSync(external, path.join(configDir, "public"), "dir");

        expect(resolvePublicStaticRoot(configDir, "public", logger as never)).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            "public_static_dir 的实际目录必须位于配置目录内，已忽略",
            expect.objectContaining({ resolved: fs.realpathSync(external) }),
        );
    });
});
