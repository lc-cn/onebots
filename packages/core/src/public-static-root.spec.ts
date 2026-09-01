import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectPublicStaticRoot, resolvePublicStaticRoot } from "./public-static-root.js";

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

    it("检查模式不创建目录，明确修复时才创建", () => {
        const { configDir } = createFixture();
        const expected = path.join(configDir, "public");

        expect(inspectPublicStaticRoot(configDir, "public")).toEqual({
            status: "missing",
            root: expected,
            created: false,
        });
        expect(fs.existsSync(expected)).toBe(false);
        expect(inspectPublicStaticRoot(configDir, "public", true)).toEqual({
            status: "ready",
            root: fs.realpathSync(expected),
            created: true,
        });
    });

    it("接受名称以两个点开头但仍位于配置目录内的目录", () => {
        const { configDir } = createFixture();

        const inspection = inspectPublicStaticRoot(configDir, "..public", true);

        expect(inspection).toMatchObject({ status: "ready", created: true });
        expect(inspection.root).toBe(fs.realpathSync(path.join(configDir, "..public")));
    });

    it.runIf(process.platform !== "win32")("拒绝通过相对符号链接逃出配置目录", () => {
        const { configDir, logger } = createFixture();
        const external = path.join(path.dirname(configDir), "external");
        fs.mkdirSync(external);
        fs.symlinkSync(external, path.join(configDir, "public"), "dir");

        expect(resolvePublicStaticRoot(configDir, "public", logger as never)).toBeNull();
        expect(logger.warn).toHaveBeenCalledWith(
            "public_static_dir 的实际目录必须位于配置目录内，已忽略",
            expect.objectContaining({ resolved: path.join(configDir, "public") }),
        );
    });

    it.runIf(process.platform !== "win32")("创建前拒绝通过已有父级符号链接在配置目录外落盘", () => {
        const { configDir } = createFixture();
        const external = path.join(path.dirname(configDir), "external");
        fs.mkdirSync(external);
        fs.symlinkSync(external, path.join(configDir, "linked"), "dir");

        const inspection = inspectPublicStaticRoot(configDir, "linked/public", true);

        expect(inspection).toMatchObject({ status: "invalid" });
        expect(fs.existsSync(path.join(external, "public"))).toBe(false);
    });
});
