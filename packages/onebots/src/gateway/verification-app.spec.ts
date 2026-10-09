import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { expect, it, vi } from "vitest";
import { BaseApp } from "@onebots/core";
import { MockAdapter } from "../../../../adapters/adapter-mock/src/adapter.js";
import { GatewayApp } from "./app.js";

it("真实网关收集验证挑战，旧完成回执不能清除替换后的挑战", async () => {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-verification-app-"));
    const previous = { directory: BaseApp.configDir, file: BaseApp.configFileName };
    let app: GatewayApp | undefined;
    try {
        BaseApp.configDir = root;
        BaseApp.configFileName = "snapshot.yaml";
        fs.mkdirSync(path.join(root, "data"));
        app = new GatewayApp({
            log_level: "off",
            general: {},
            "mock.bot": { auto_events: false },
        });
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
        try {
            await app?.stop();
        } finally {
            BaseApp.configDir = previous.directory;
            BaseApp.configFileName = previous.file;
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});

it.each(["applied", "rolled_back"] as const)("热配置 %s 只在实际应用后清理旧挑战", async status => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-verification-hot-")));
    const previous = BaseApp.configDir;
    let app: GatewayApp | undefined;
    let restoreApply: (() => void) | undefined;
    try {
        BaseApp.configDir = root;
        const current = new GatewayApp({
            log_level: "off",
            general: {},
            "mock.bot": { auto_events: false },
        });
        app = current;
        const payload = { platform: "mock", account_id: "bot", type: "qrcode", hint: "scan" };
        current.verification.record(payload);
        const old = current.verification.list()[0];
        let during: string | undefined;
        const apply = vi
            .spyOn(BaseApp.prototype, "applyRuntimeConfiguration")
            .mockImplementation(async () => {
                // 同账号不同验证类型可与旧挑战共存，不能借 record 的替换语义隐藏误清。
                current.verification.record({ ...payload, type: "sms", hint: "new during apply" });
                during = current.verification
                    .list()
                    .find(challenge => challenge.request.type === "sms")?.id;
                return {
                    status,
                    impact: {
                        mode: "hot",
                        accounts: [],
                        protocols: [],
                        dynamicFields: [],
                        restartReasons: [],
                    },
                };
            });
        restoreApply = () => apply.mockRestore();
        await current.applyRuntimeConfiguration({
            log_level: "off",
            general: {},
            "mock.bot": { auto_events: true },
        });
        expect(Boolean(current.verification.get(old.id))).toBe(status === "rolled_back");
        expect(during).toBeDefined();
        expect(current.verification.get(during!)?.request.hint).toBe("new during apply");
        current.verification.record({ ...payload, type: "device", hint: "new after apply" });
        expect(
            current.verification
                .list()
                .some(challenge => challenge.request.hint === "new after apply"),
        ).toBe(true);
    } finally {
        try {
            restoreApply?.();
            await app?.stop();
        } finally {
            BaseApp.configDir = previous;
            fs.rmSync(root, { recursive: true, force: true });
        }
    }
});
