import fs from "node:fs";
import { afterEach, expect, it } from "vitest";
import { ControlClient, createHttpControlTransport } from "@onebots/core/control";
import { startControlHost } from "./host.js";
import { createLocalControlClient } from "../client/local-control.js";
let host: Awaited<ReturnType<typeof startControlHost>> | undefined;
let directory: string | undefined;
afterEach(async () => {
    await host?.close();
    if (directory) fs.rmSync(directory, { recursive: true, force: true });
});
it("恢复码仅本地签发，HTTP匿名和已有token均无重置权限，兑换后旧token失效", async () => {
    directory = fs.mkdtempSync("/tmp/ob-recover-");
    host = await startControlHost({ workspace: directory, port: 0 });
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("missing listener");
    const url = `http://127.0.0.1:${address.port}`;
    const local = createLocalControlClient(directory);
    const unauthenticated = new ControlClient(createHttpControlTransport(url, () => ""));
    const original = await unauthenticated.pair((await local.bootstrap()).code);
    const old = new ControlClient(createHttpControlTransport(url, () => original.token));
    for (const token of ["", original.token]) {
        const response = await fetch(`${url}/api/control/auth/recovery`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: "{}",
        });
        expect(response.status).toBe(403);
        expect(await response.text()).not.toContain("code");
    }
    const recovery = await local.recoverAuthentication();
    await expect(old.status()).resolves.toHaveProperty("manager");
    const next = await unauthenticated.pair(recovery.code);
    await expect(old.status()).rejects.toThrow();
    await expect(unauthenticated.pair(recovery.code)).rejects.toThrow();
    const current = new ControlClient(createHttpControlTransport(url, () => next.token));
    await expect(current.status()).resolves.toHaveProperty("manager");
});
