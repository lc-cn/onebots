import fs from "node:fs";
import path from "node:path";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it } from "vitest";
import { waitForProcessGroupExit } from "../process-group-exit.js";

const directories: string[] = [];
afterEach(() => {
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});
it.skipIf(process.platform === "win32").each(["success", "failure", "disconnect"])(
    "真实worker %s只删除敏感请求，所有权记录交父进程收尾",
    async mode => {
        const directory = fs.mkdtempSync("/tmp/ob-owner-");
        directories.push(directory);
        const host = path.join(directory, "host");
        fs.mkdirSync(host);
        fs.writeFileSync(path.join(host, "package.json"), '{"type":"module"}');
        fs.writeFileSync(
            path.join(host, "index.js"),
            mode === "disconnect"
                ? "process.send({ready:true}); await new Promise(()=>{});"
                : mode === "failure"
                  ? 'throw new Error("private failure");'
                  : "export {};",
        );
        fs.writeFileSync(path.join(host, "plugin-loader.js"), "export {};");
        fs.writeFileSync(
            path.join(host, "runtime-config-validator.js"),
            "export function validateRuntimeConfig() {}",
        );
        const ownership = JSON.stringify({ test: "parent-owned evidence" });
        fs.writeFileSync(path.join(directory, "owner.json"), ownership);
        fs.writeFileSync(
            path.join(directory, "request.json"),
            JSON.stringify({
                runtimeRoot: host,
                hostEntrypoint: path.join(host, "index.js"),
                selection: { adapters: [], protocols: [], applications: [] },
                document: { password: "private-value" },
            }),
        );
        const messages: unknown[] = [];
        let workerPid = 0;
        const code = await new Promise<number | null>((resolve, reject) => {
            const worker = fork(
                fileURLToPath(
                    new URL(
                        "../../lib/configuration/configuration-verify-worker.js",
                        import.meta.url,
                    ),
                ),
                [directory],
                {
                    detached: true,
                    execArgv: [],
                    stdio: ["ignore", "ignore", "ignore", "ipc"],
                    env: { PATH: process.env.PATH },
                },
            );
            workerPid = worker.pid ?? 0;
            const timer = setTimeout(() => {
                try {
                    if (worker.pid) process.kill(-worker.pid, "SIGKILL");
                } catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ESRCH") reject(error);
                }
                reject(new Error("worker未在期限内退出"));
            }, 5000);
            worker.on("message", message => {
                messages.push(message);
                if (mode === "disconnect") worker.disconnect();
            });
            worker.once("error", error => {
                clearTimeout(timer);
                reject(error);
            });
            worker.once("exit", exitCode => {
                clearTimeout(timer);
                resolve(exitCode);
            });
            worker.send({ type: "start" });
        });
        expect(code).toBe(mode === "success" ? 0 : mode === "failure" ? 1 : null);
        expect(workerPid).toBeGreaterThan(0);
        expect(await waitForProcessGroupExit(workerPid, 2000)).toBe("exited");
        expect(fs.readFileSync(path.join(directory, "owner.json"), "utf8")).toBe(ownership);
        expect(fs.existsSync(path.join(directory, "request.json"))).toBe(false);
        expect(JSON.stringify(messages)).not.toMatch(/private-value|private failure/);
        if (mode === "success") expect(messages).toEqual([{ valid: true, issues: [] }]);
    },
);
