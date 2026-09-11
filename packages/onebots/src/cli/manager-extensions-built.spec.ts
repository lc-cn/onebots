import http from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("构建后的 extensions remove 只向管理服务生成不可变移除计划", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-extensions-remove-"));
    await fs.mkdir(path.join(root, ".control"));
    const calls: Array<{ method?: string; url?: string; body: unknown }> = [];
    const server = http.createServer((request, response) => {
        const chunks: Buffer[] = [];
        request.on("data", chunk => chunks.push(chunk));
        request.on("end", () => {
            const body = chunks.length
                ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
                : undefined;
            calls.push({ method: request.method, url: request.url, body });
            response.setHeader("content-type", "application/json");
            if (request.url === "/api/control/installations/catalog")
                response.end(
                    JSON.stringify({
                        activeGenerationId: null,
                        selection: { adapters: ["mock"], protocols: [], applications: [] },
                        adapters: [],
                        protocols: [],
                        applications: [],
                    }),
                );
            else if (request.url === "/api/control/installations/plan")
                response.end(
                    JSON.stringify({
                        id: "a".repeat(64),
                        planDigest: "b".repeat(64),
                        baseGenerationId: null,
                        selection: { adapters: [], protocols: [], applications: [] },
                        removed: { adapters: ["mock"], protocols: [], applications: [] },
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
    });
    try {
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(path.join(root, ".control/control.sock"), resolve);
        });
        const result = await new Promise<{ code: number | null; stdout: string; stderr: string }>(
            (resolve, reject) => {
                const child = spawn(
                    process.execPath,
                    [
                        fileURLToPath(new URL("../../lib/bin.js", import.meta.url)),
                        "extensions",
                        "remove",
                        "--adapter",
                        "mock",
                        "--plan-only",
                        "--data-dir",
                        root,
                    ],
                    { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
                );
                let stdout = "";
                let stderr = "";
                child.stdout.on("data", chunk => (stdout += chunk.toString()));
                child.stderr.on("data", chunk => (stderr += chunk.toString()));
                child.once("error", reject);
                child.once("exit", code => resolve({ code, stdout, stderr }));
            },
        );
        expect(result).toMatchObject({ code: 0, stderr: "" });
        expect(JSON.parse(result.stdout).removed.adapters).toEqual(["mock"]);
        expect(calls).toEqual([
            {
                method: "GET",
                url: "/api/control/installations/catalog",
                body: undefined,
            },
            {
                method: "POST",
                url: "/api/control/installations/plan",
                body: {
                    selection: { adapters: [], protocols: [], applications: [] },
                    expectedGenerationId: null,
                },
            },
        ]);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        await fs.rm(root, { recursive: true, force: true });
    }
});
