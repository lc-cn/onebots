import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Router, RouterContext } from "@onebots/core";
import type { App } from "../app.js";
import { MANAGEMENT_EXPECTED_INSTANCE_HEADER } from "../management-instance-precondition.js";
import {
    capturePublicStaticSnapshot,
    EXPECTED_PUBLIC_STATIC_REVISION_HEADER,
} from "../public-static-snapshot.js";
import { registerPublicStaticRoutes } from "./public-static.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

const temporaryDirectories: string[] = [];

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function setup(rootAvailable = true) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-public-route-"));
    temporaryDirectories.push(directory);
    const root = path.join(directory, "public");
    fs.mkdirSync(root);
    const gets = new Map<string, RouteHandler>();
    const posts = new Map<string, RouteHandler>();
    const deletes = new Map<string, RouteHandler>();
    const backup = vi.fn(async () => ({ attempted: false as const }));
    const app = {
        getPublicStaticRoot: () => (rootAvailable ? root : null),
        backupDataDirToHfAfterStaticChange: backup,
        logger: { error: vi.fn() },
        runtimeContractId: "sha256:contract-a",
        info: {
            application_name: "onebots",
            application_version: "1.2.8",
            instance_id: "instance-a",
        },
    } as unknown as App;
    registerPublicStaticRoutes(app, {
        get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        post: vi.fn((route: string, handler: RouteHandler) => posts.set(route, handler)),
        delete: vi.fn((route: string, handler: RouteHandler) => deletes.set(route, handler)),
    } as unknown as Router);
    return { app, directory, root, gets, posts, deletes, backup };
}

function uploadContext(
    filepath: string,
    originalFilename: string,
    headers: Record<string, string> = {},
): RouterContext {
    return {
        request: { files: { file: { filepath, originalFilename } } },
        get: (name: string) => headers[name] ?? "",
        set: vi.fn(),
    } as unknown as RouterContext;
}

function deleteContext(filename: string, headers: Record<string, string> = {}): RouterContext {
    return {
        params: { filename },
        get: (name: string) => headers[name] ?? "",
        set: vi.fn(),
    } as unknown as RouterContext;
}

describe("public static routes", () => {
    it("列表正文与响应头发布同一实例和静态目录修订", () => {
        const { root, gets } = setup();
        fs.writeFileSync(path.join(root, "asset.txt"), "content");
        const ctx = { set: vi.fn() } as unknown as RouterContext;

        gets.get("/api/public-static/files")!(ctx);

        expect(ctx.body).toMatchObject({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            static_revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            files: ["asset.txt"],
            root,
        });
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith(
            "X-OneBots-Public-Static-Revision",
            (ctx.body as { static_revision: string }).static_revision,
        );
    });

    it("在静态根内原子替换常规文件并清理上传临时文件", async () => {
        const { directory, root, posts, backup } = setup();
        const source = path.join(directory, "upload.tmp");
        fs.writeFileSync(source, "next");
        fs.writeFileSync(path.join(root, "asset.txt"), "previous");
        if (process.platform !== "win32") fs.chmodSync(path.join(root, "asset.txt"), 0o640);
        const ctx = uploadContext(source, "asset.txt");

        await posts.get("/api/public-static/upload")!(ctx);

        expect(ctx.body).toMatchObject({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            static_revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            message: "上传成功",
            filename: "asset.txt",
        });
        expect(fs.readFileSync(path.join(root, "asset.txt"), "utf8")).toBe("next");
        expect(fs.existsSync(source)).toBe(false);
        expect(fs.readdirSync(root)).toEqual(["asset.txt"]);
        if (process.platform !== "win32") {
            expect(fs.statSync(path.join(root, "asset.txt")).mode & 0o777).toBe(0o640);
        }
        expect(backup).toHaveBeenCalledOnce();
    });

    it("未配置静态根时也清理已解析的上传临时文件", async () => {
        const { directory, posts, backup } = setup(false);
        const source = path.join(directory, "upload.tmp");
        fs.writeFileSync(source, "content");
        const ctx = uploadContext(source, "asset.txt");

        await posts.get("/api/public-static/upload")!(ctx);

        expect(ctx.status).toBe(400);
        expect(ctx.body).toMatchObject({
            success: false,
            message: expect.stringContaining("设置"),
        });
        expect(fs.existsSync(source)).toBe(false);
        expect(backup).not.toHaveBeenCalled();
    });

    it("在触碰目标前拒绝旧实例和过期静态目录快照", async () => {
        const { directory, root, posts, deletes, backup } = setup();
        const target = path.join(root, "asset.txt");
        fs.writeFileSync(target, "preserved");
        const revision = capturePublicStaticSnapshot(root).revision;
        const source = path.join(directory, "upload.tmp");
        fs.writeFileSync(source, "replacement");
        const staleInstance = uploadContext(source, "asset.txt", {
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: "instance-old",
            [EXPECTED_PUBLIC_STATIC_REVISION_HEADER]: revision,
        });

        await posts.get("/api/public-static/upload")!(staleInstance);

        expect(staleInstance.status).toBe(409);
        expect(staleInstance.body).toMatchObject({
            success: false,
            instance_id: "instance-a",
            message: expect.stringContaining("当前已由实例 instance-a 接管"),
        });
        expect(fs.readFileSync(target, "utf8")).toBe("preserved");
        expect(fs.existsSync(source)).toBe(false);

        fs.writeFileSync(path.join(root, "other.txt"), "changed");
        const staleList = deleteContext("asset.txt", {
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: "instance-a",
            [EXPECTED_PUBLIC_STATIC_REVISION_HEADER]: revision,
        });
        await deletes.get("/api/public-static/:filename")!(staleList);

        expect(staleList.status).toBe(409);
        expect(staleList.body).toMatchObject({
            success: false,
            message: "静态文件删除使用的静态文件列表已经过期，请刷新后再操作",
        });
        expect(fs.readFileSync(target, "utf8")).toBe("preserved");
        expect(backup).not.toHaveBeenCalled();
    });

    it("删除成功后签发新的静态目录修订", async () => {
        const { root, deletes, backup } = setup();
        const target = path.join(root, "asset.txt");
        fs.writeFileSync(target, "content");
        const revision = capturePublicStaticSnapshot(root).revision;
        const ctx = deleteContext("asset.txt", {
            [MANAGEMENT_EXPECTED_INSTANCE_HEADER]: "instance-a",
            [EXPECTED_PUBLIC_STATIC_REVISION_HEADER]: revision,
        });

        await deletes.get("/api/public-static/:filename")!(ctx);

        expect(ctx.body).toMatchObject({
            success: true,
            application: "onebots",
            instance_id: "instance-a",
            static_revision: expect.stringMatching(/^sha256:[a-f0-9]{64}$/u),
            message: "已删除",
        });
        expect((ctx.body as { static_revision: string }).static_revision).not.toBe(revision);
        expect(ctx.set).toHaveBeenCalledWith(
            "X-OneBots-Public-Static-Revision",
            (ctx.body as { static_revision: string }).static_revision,
        );
        expect(fs.existsSync(target)).toBe(false);
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
        const ctx = deleteContext("asset.txt");

        await deletes.get("/api/public-static/:filename")!(ctx);

        expect(ctx.status).toBe(409);
        expect(fs.readFileSync(external, "utf8")).toBe("preserved");
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(backup).not.toHaveBeenCalled();
    });
});
