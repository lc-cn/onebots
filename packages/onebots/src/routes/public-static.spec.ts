import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router, RouterContext } from "@onebots/core";
import type { App } from "../app.js";
import { registerPublicStaticRoutes } from "./public-static.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function setup() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-public-route-"));
    temporaryDirectories.push(directory);
    const root = path.join(directory, "public");
    fs.mkdirSync(root);
    const posts = new Map<string, RouteHandler>();
    const deletes = new Map<string, RouteHandler>();
    const backup = vi.fn(async () => ({ attempted: false as const }));
    const app = {
        getPublicStaticRoot: () => root,
        backupDataDirToHfAfterStaticChange: backup,
    } as unknown as App;
    registerPublicStaticRoutes(app, {
        get: vi.fn(),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
        delete: vi.fn((route: string, handler: RouteHandler) => deletes.set(route, handler)),
    } as unknown as Router);
    return { directory, root, posts, deletes, backup };
}

function uploadContext(filepath: string, originalFilename: string): RouterContext {
    return {
        request: { files: { file: { filepath, originalFilename } } },
    } as unknown as RouterContext;
}

describe("public static routes", () => {
    it("在静态根内原子替换常规文件并清理上传临时文件", async () => {
        const { directory, root, posts, backup } = setup();
        const source = path.join(directory, "upload.tmp");
        fs.writeFileSync(source, "next");
        fs.writeFileSync(path.join(root, "asset.txt"), "previous");
        if (process.platform !== "win32") fs.chmodSync(path.join(root, "asset.txt"), 0o640);
        const ctx = uploadContext(source, "asset.txt");

        await posts.get("/api/public-static/upload")!(ctx);

        expect(ctx.body).toEqual({ success: true, message: "上传成功", filename: "asset.txt" });
        expect(fs.readFileSync(path.join(root, "asset.txt"), "utf8")).toBe("next");
        expect(fs.existsSync(source)).toBe(false);
        expect(fs.readdirSync(root)).toEqual(["asset.txt"]);
        if (process.platform !== "win32") {
            expect(fs.statSync(path.join(root, "asset.txt")).mode & 0o777).toBe(0o640);
        }
        expect(backup).toHaveBeenCalledOnce();
    });

    it.runIf(process.platform !== "win32")("拒绝通过已有符号链接覆盖静态根外文件", async () => {
        const { directory, root, posts, backup } = setup();
        const source = path.join(directory, "upload.tmp");
        const external = path.join(directory, "external.txt");
        fs.writeFileSync(source, "malicious");
        fs.writeFileSync(external, "preserved");
        fs.symlinkSync(external, path.join(root, "asset.txt"));
        const ctx = uploadContext(source, "asset.txt");

        await posts.get("/api/public-static/upload")!(ctx);

        expect(ctx.status).toBe(409);
        expect(ctx.body).toMatchObject({
            success: false,
            message: expect.stringContaining("符号链接"),
        });
        expect(fs.readFileSync(external, "utf8")).toBe("preserved");
        expect(fs.lstatSync(path.join(root, "asset.txt")).isSymbolicLink()).toBe(true);
        expect(fs.existsSync(source)).toBe(false);
        expect(backup).not.toHaveBeenCalled();
    });

    it.runIf(process.platform !== "win32")("拒绝通过管理接口删除符号链接", async () => {
        const { directory, root, deletes, backup } = setup();
        const external = path.join(directory, "external.txt");
        fs.writeFileSync(external, "preserved");
        const link = path.join(root, "asset.txt");
        fs.symlinkSync(external, link);
        const ctx = { params: { filename: "asset.txt" } } as unknown as RouterContext;

        await deletes.get("/api/public-static/:filename")!(ctx);

        expect(ctx.status).toBe(409);
        expect(fs.readFileSync(external, "utf8")).toBe("preserved");
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(backup).not.toHaveBeenCalled();
    });
});
