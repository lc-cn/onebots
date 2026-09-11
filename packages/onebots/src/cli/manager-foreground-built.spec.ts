import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";
import { once } from "node:events";
import { yaml } from "@onebots/core";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalControlClient } from "../client/local-control.js";
const bin = fileURLToPath(new URL("../../lib/bin.js", import.meta.url));
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function directory() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-run-"));
    roots.push(root);
    fs.chmodSync(root, 0o700);
    return root;
}
function environment(root: string) {
    return {
        ...process.env,
        HOME: root,
        XDG_CONFIG_HOME: path.join(root, "config"),
        XDG_STATE_HOME: path.join(root, "state"),
        ONEBOTS_WORKSPACE: root,
        NODE_ENV: "test",
    };
}
async function port() {
    const server = net.createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("no port");
    await new Promise<void>(resolve => server.close(() => resolve()));
    return address.port;
}
describe("built public manager foreground", () => {
    it("run help creates no workspace or home files", () => {
        const root = directory();
        const output = execFileSync(process.execPath, [bin, "run", "--help"], {
            cwd: root,
            env: environment(root),
            encoding: "utf8",
            timeout: 15000,
        });
        expect(output).toContain("onebots serve");
        expect(fs.readdirSync(root)).toEqual([]);
    });
    it.each(["-c", "-r", "-p", "-t"])("rejects public legacy %s without writing files", flag => {
        const root = directory();
        let failure: unknown;
        try {
            execFileSync(process.execPath, [bin, "run", flag, "synthetic"], {
                cwd: root,
                env: environment(root),
                encoding: "utf8",
                timeout: 15000,
                stdio: "pipe",
            });
        } catch (error) {
            failure = error;
        }
        expect(failure).toMatchObject({ status: 1 });
        expect(String((failure as { stderr: unknown }).stderr)).toContain("migrate");
        expect(fs.readdirSync(root)).toEqual([]);
    });
    it.each([false, true])(
        "nonTTY explicit run=%s starts a manager without configured platforms or protocols",
        async explicit => {
            const root = directory();
            const listeningPort = await port();
            const child = spawn(
                process.execPath,
                [bin, ...(explicit ? ["--data-dir", root, "run"] : [])],
                {
                    cwd: root,
                    env: { ...environment(root), PORT: String(listeningPort) },
                    stdio: ["ignore", "pipe", "pipe"],
                },
            );
            const exited = once(child, "exit");
            child.stderr.resume();
            try {
                await new Promise<void>((resolve, reject) => {
                    const timer = setTimeout(
                        () => reject(new Error("manager startup timeout")),
                        15000,
                    );
                    let text = "";
                    child.stdout.on("data", chunk => {
                        text += String(chunk);
                        if (text.includes("管理服务已启动")) {
                            clearTimeout(timer);
                            resolve();
                        }
                    });
                    child.once("exit", () => {
                        clearTimeout(timer);
                        reject(new Error("manager exited before readiness"));
                    });
                    child.once("error", error => {
                        clearTimeout(timer);
                        reject(error);
                    });
                });
                const client = createLocalControlClient(root);
                const status = await client.status();
                expect(status.manager.pid).toBe(child.pid);
                // serve 既有设计允许启动空网关；空安装契约是没有配置任何账号或协议。
                expect(yaml.load(fs.readFileSync(path.join(root, "config.yaml"), "utf8"))).toEqual({
                    plugins: { adapters: [], protocols: [], applications: [] },
                });
                const login = await fetch(`http://127.0.0.1:${listeningPort}/api/auth/login`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ username: "admin", password: "admin" }),
                });
                expect([401, 404]).toContain(login.status);
                expect(login.headers.get("set-cookie")).toBeNull();
                await login.body?.cancel();
                await client.gateway("stop");
                const stopped = await client.status();
                expect(stopped.gateway.actual).toBe("stopped");
                expect(stopped.manager.id).toBe(status.manager.id);
                const health = await fetch(`http://127.0.0.1:${listeningPort}/healthz`);
                expect(health.status).toBe(200);
                await health.body?.cancel();
            } finally {
                child.kill("SIGTERM");
                const timeout = setTimeout(() => child.kill("SIGKILL"), 8000);
                const [code] = await exited;
                clearTimeout(timeout);
                expect(code).toBe(0);
            }
        },
    );
});
