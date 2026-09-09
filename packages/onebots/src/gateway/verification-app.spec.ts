import fs from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { BaseApp } from "@onebots/core";
import { MockAdapter } from "../../../../adapters/adapter-mock/src/adapter.js";
import { GatewayApp } from "./app.js";

it("真实网关收集验证挑战，旧完成回执不能清除替换后的挑战", async () => {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-verification-app-"));
    const previous = { directory: BaseApp.configDir, file: BaseApp.configFileName };
    BaseApp.configDir = root;
    BaseApp.configFileName = "snapshot.yaml";
    fs.mkdirSync(path.join(root, "data"));
    const app = new GatewayApp({
        log_level: "off",
        general: {},
        "mock.bot": { auto_events: false },
    });
    try {
        await app.start();
        const adapter = app.adapters.get("mock");
        if (!(adapter instanceof MockAdapter)) throw new Error("Mock adapter missing");
        const payload = { platform: "mock", account_id: "bot", type: "qrcode", hint: "scan" };
        adapter.emit("verification:request", payload);
        const first = app.verification.list()[0];
        expect(first.request).toEqual(payload);
        adapter.emit("verification:request", { ...payload, hint: "new QR" });
        const next = app.verification.list()[0];
        expect(next.id).not.toBe(first.id);
        expect(app.verification.complete(first.id)).toBe(false);
        expect(app.verification.get(next.id)?.request.hint).toBe("new QR");
        adapter.emit("verification:clear", { platform: "mock", account_id: "bot" });
        expect(app.verification.list()).toEqual([]);
        adapter.emit("verification:request", payload);
        await app.stop();
        adapter.emit("verification:request", payload);
        expect(app.verification.list()).toEqual([]);
    } finally {
        await app.stop();
        BaseApp.configDir = previous.directory;
        BaseApp.configFileName = previous.file;
        fs.rmSync(root, { recursive: true, force: true });
    }
});
