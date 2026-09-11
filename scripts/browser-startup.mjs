import fs from "node:fs";
import path from "node:path";

/** 仅在配对/导航之前收集启动诊断；成功后停止保存浏览器输出。 */
export function waitForBrowserPort(child, profile, { timeout = 30_000, interval = 100 } = {}) {
    return new Promise((resolve, reject) => {
        let stderr = Buffer.alloc(0);
        let finished = false;
        let poll;
        let deadline;
        const capture = chunk => {
            stderr = Buffer.concat([stderr, Buffer.from(chunk)]).subarray(-4096);
        };
        const diagnostic = () => {
            let text = stderr.toString("utf8").replaceAll(profile, "<browser-profile>");
            for (const [name, value] of Object.entries(process.env)) {
                if (/token|secret|password|key/i.test(name) && value && value.length >= 6)
                    text = text.replaceAll(value, "<redacted>");
            }
            return text.replace(/[\u0000-\u001f\u007f]/gu, " ").trim();
        };
        const finish = (error, port) => {
            if (finished) return;
            finished = true;
            clearInterval(poll);
            clearTimeout(deadline);
            child.off("error", failed);
            child.off("close", closed);
            child.stderr?.off("data", capture);
            // 持续排空管道，避免后续 Chromium 输出填满后阻塞 UI 验收。
            child.stderr?.resume();
            if (error) reject(error);
            else resolve(port);
        };
        const failed = error => finish(new Error(`浏览器启动失败：${error.code ?? "SPAWN_ERROR"}`));
        const closed = (code, signal) =>
            finish(
                new Error(
                    `浏览器在调试端口就绪前退出（exit=${code}, signal=${signal ?? "none"}）${diagnostic() ? `：${diagnostic()}` : ""}`,
                ),
            );
        const check = () => {
            if (child.exitCode !== null || child.signalCode !== null) return;
            try {
                const content = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8");
                const [port, endpoint] = content.trim().split(/\r?\n/u);
                if (
                    /^[0-9]+$/u.test(port) &&
                    Number(port) > 0 &&
                    Number(port) <= 65535 &&
                    endpoint?.startsWith("/devtools/browser/")
                )
                    finish(undefined, Number(port));
            } catch (error) {
                if (error.code !== "ENOENT")
                    finish(new Error(`浏览器调试端口文件不可读取：${error.code ?? "READ_ERROR"}`));
            }
        };
        child.stderr?.on("data", capture);
        child.once("error", failed);
        child.once("close", closed);
        poll = setInterval(check, interval);
        deadline = setTimeout(
            () =>
                finish(
                    new Error(
                        `浏览器调试端口启动超时${diagnostic() ? `：${diagnostic()}` : "（无启动输出）"}`,
                    ),
                ),
            timeout,
        );
        check();
    });
}
