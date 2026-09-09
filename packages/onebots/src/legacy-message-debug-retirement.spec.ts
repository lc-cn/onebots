import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { BaseApp } from "@onebots/core";
import { App } from "./app.js";

class LocalLegacyApp extends App {
    protected override listenHttpServer(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.httpServer.once("error", reject);
            this.httpServer.listen({ host: "127.0.0.1", port: 0 }, () => {
                this.httpServer.removeListener("error", reject);
                resolve();
            });
        });
    }
}
it("旧 App 不再提供消息调试，但其余管理入口仍保持鉴权", async () => {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-retired-debug-"));
    const previous = { directory: BaseApp.configDir, file: BaseApp.configFileName };
    BaseApp.configDir = root;
    BaseApp.configFileName = "config.yaml";
    fs.mkdirSync(path.join(root, "data"));
    const app = new LocalLegacyApp({ log_level: "off", access_token: "test-retired-debug-token", general: {} });
    try {
        await app.start();
        const address = app.httpServer.address();
        if (!address || typeof address === "string") throw new Error("no listener");
        const base = `http://127.0.0.1:${address.port}`;
        const headers = { Authorization: "Bearer test-retired-debug-token" };
        expect((await fetch(`${base}/api/auth/me`)).status).toBe(401);
        expect((await fetch(`${base}/api/auth/me`, { headers })).status).toBe(200);
        for (const action of ["history", "stream", "clear"]) {
            const response = await fetch(`${base}/api/message-debug/${action}`, {
                headers, method: action === "clear" ? "POST" : "GET",
            });
            expect(response.status).toBe(404);
            await response.body?.cancel();
        }
    } finally {
        await app.stop();
        BaseApp.configDir = previous.directory;
        BaseApp.configFileName = previous.file;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
