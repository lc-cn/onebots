import { afterEach, expect, it } from "vitest";
import { type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { serveControlWeb } from "./web-assets.js";

let webRoot: string | undefined;
afterEach(() => {
    if (webRoot) rmSync(webRoot, { recursive: true, force: true });
    webRoot = undefined;
});

class TestResponse extends Writable {
    statusCode = 200;
    readonly chunks: Buffer[] = [];
    writeHead(statusCode: number) {
        this.statusCode = statusCode;
        return this;
    }
    override _write(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void,
    ) {
        this.chunks.push(chunk);
        callback();
    }
    get body() {
        return Buffer.concat(this.chunks).toString("utf8");
    }
}

async function serve(pathname: string, root: string) {
    const response = new TestResponse();
    const served = serveControlWeb(
        { method: "GET" } as IncomingMessage,
        response as unknown as ServerResponse,
        pathname,
        root,
    );
    if (served) await new Promise<void>(resolve => response.once("finish", resolve));
    return { served, response };
}

it("History 子页面刷新仍返回管理端，非管理路径仍交给网关", async () => {
    webRoot = mkdtempSync(join(tmpdir(), "onebots-web-assets-"));
    mkdirSync(join(webRoot, "assets"));
    writeFileSync(join(webRoot, "index.html"), "<html>control</html>");
    writeFileSync(join(webRoot, "assets", "entry.js"), "export {};");
    for (const route of [
        "/",
        "/console",
        "/console/overview",
        "/console/accounts/mock/bot/edit",
        "/console/protocols/mock/bot/onebot.v11",
    ]) {
        const { served, response } = await serve(route, webRoot);
        expect(served).toBe(true);
        expect(response.body).toBe("<html>control</html>");
    }
    const asset = await serve("/assets/entry.js", webRoot);
    expect(asset.response.body).toBe("export {};");
    expect((await serve("/mock/bot/onebot/v11", webRoot)).served).toBe(false);
});
