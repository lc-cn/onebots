import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterEach, expect, it } from "vitest";
import { ControlAuth } from "../control/auth.js";
import { prepareManagerAuthenticationProbe } from "./manager-authentication.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-auth-probe-"));
    roots.push(root);
    const probe = prepareManagerAuthenticationProbe(root);
    const statePath = path.join(root, ".control/auth.json");
    return { root, probe, statePath, auth: new ControlAuth({ statePath }) };
}
it.each(["valid", "old-single-session", "anonymous-open", "unknown-device-open", "rewrites-state"])(
    "通过真实 HTTP 检查候选认证行为：%s",
    async mode => {
        const f = fixture();
        const bytes = fs.readFileSync(f.statePath, "utf8");
        expect(JSON.parse(bytes).version).toBe(2);
        expect(JSON.parse(bytes).sessions).toHaveLength(2);
        expect(fs.statSync(f.statePath).mode & 0o777).toBe(0o600);
        let firstToken: string | undefined;
        const server = http.createServer((request, response) => {
            const token = request.headers.authorization?.replace(/^Bearer /, "");
            let allowed = token !== undefined && f.auth.verify(token);
            if (allowed && firstToken === undefined) firstToken = token;
            if (mode === "old-single-session" && token !== firstToken) allowed = false;
            if (mode === "anonymous-open" && token === undefined) allowed = true;
            if (mode === "unknown-device-open" && token !== undefined) allowed = true;
            response.writeHead(allowed ? 200 : 401).end();
        });
        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(0, "127.0.0.1", resolve);
        });
        try {
            const address = server.address();
            if (!address || typeof address === "string") throw new Error("测试监听失败");
            const run = f.probe.verify(`http://127.0.0.1:${address.port}`);
            if (mode === "valid" || mode === "rewrites-state") await run;
            else await expect(run).rejects.toThrow("候选未通过多设备认证格式验证");
            if (mode === "rewrites-state") {
                fs.writeFileSync(f.statePath, `${bytes}\n`);
                expect(() => f.probe.assertPreserved()).toThrow("候选改变了已有设备认证状态");
            } else {
                f.probe.assertPreserved();
                expect(fs.readFileSync(f.statePath, "utf8")).toBe(bytes);
            }
        } finally {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) =>
                server.close(error => (error ? reject(error) : resolve())),
            );
        }
    },
);
it("拒绝覆盖工作区既有认证数据", () => {
    const f = fixture();
    const before = fs.readFileSync(f.statePath, "utf8");
    expect(() => prepareManagerAuthenticationProbe(f.root)).toThrow("独立空白工作区");
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(before);
});
