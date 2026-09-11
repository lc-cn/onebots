import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { expect, it } from "vitest";

it("构建后的update --check经本地管理socket返回2，只查询摘要与计划", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-update-"));
    await fs.mkdir(path.join(root, ".control"));
    const calls: string[] = [];
    const base = { generationId: null, configRevision: "a".repeat(64) };
    const server = http.createServer((request, response) => {
        calls.push(`${request.method} ${request.url}`);
        request.resume();
        response.setHeader("content-type", "application/json");
        if (request.url === "/api/control/configuration/source")
            response.end(JSON.stringify({ state: "ready", base }));
        else if (request.url === "/api/control/updates/plan")
            response.end(
                JSON.stringify({
                    state: "updates_available",
                    base,
                    packages: [],
                    peers: [],
                    recommendations: [],
                }),
            );
        else {
            response.statusCode = 500;
            response.end("{}");
        }
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(path.join(root, ".control/control.sock"), resolve);
        });
        const result = await new Promise<{ code: number | null; output: string }>(
            (resolve, reject) => {
                const child = spawn(
                    process.execPath,
                    [
                        fileURLToPath(new URL("../../lib/bin.js", import.meta.url)),
                        "update",
                        "--check",
                        "--data-dir",
                        root,
                    ],
                    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
                );
                let output = "";
                child.stdout.on("data", chunk => {
                    output += chunk.toString();
                });
                child.stderr.resume();
                const timeout = setTimeout(() => child.kill("SIGKILL"), 10_000);
                child.once("error", error => {
                    clearTimeout(timeout);
                    reject(error);
                });
                child.once("exit", code => {
                    clearTimeout(timeout);
                    resolve({ code, output });
                });
            },
        );
        expect(result.code).toBe(2);
        expect(JSON.parse(result.output)).toMatchObject({
            scope: "gateway",
            state: "updates_available",
        });
        expect(calls).toEqual([
            "GET /api/control/configuration/source",
            "POST /api/control/updates/plan",
        ]);
        expect(await fs.readdir(root)).toEqual([".control"]);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await fs.rm(root, { recursive: true, force: true });
    }
});
