import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createLocalControlClient } from "../client/local-control.js";

describe("本地控制客户端", () => {
    it("接受异步安装的 202 响应，同时保留错误状态拒绝", async () => {
        const directory = await fs.mkdtemp(path.join(os.tmpdir(), "ob-ipc-"));
        await fs.mkdir(path.join(directory, ".control"));
        const server = http.createServer((request, response) => {
            request.resume();
            if (request.url === "/api/control/installations") {
                response.writeHead(202, { "content-type": "application/json" });
                response.end(JSON.stringify({ id: "test", phase: "queued" }));
            } else {
                response.writeHead(409, { "content-type": "application/json" });
                response.end(JSON.stringify({ message: "状态已更新" }));
            }
        });
        try {
            await new Promise<void>((resolve, reject) => {
                server.once("error", reject);
                server.listen(path.join(directory, ".control/control.sock"), resolve);
            });
            const client = createLocalControlClient(directory);
            await expect(client.install({ id: "test", planId: "plan" })).resolves.toMatchObject({
                id: "test", phase: "queued",
            });
            await expect(client.status()).rejects.toThrow("状态已更新");
        } finally {
            await new Promise<void>(resolve => server.close(() => resolve()));
            await fs.rm(directory, { recursive: true, force: true });
        }
    });
});
