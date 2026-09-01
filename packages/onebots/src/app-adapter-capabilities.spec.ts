import { describe, expect, it } from "vitest";
import { App } from "./app.js";

describe("App adapter capability inventory", () => {
    it("未加载插件或配置账号时仍返回版本绑定的目录能力", () => {
        const app = Object.create(App.prototype) as App;
        Object.defineProperty(app, "pluginInfos", { value: [] });
        Object.defineProperty(app, "info", { value: { instance_id: "inventory-instance" } });

        const report = app.adapterCapabilityReport;

        expect(report).toMatchObject({
            schemaVersion: 1,
            generatedAt: expect.any(String),
            application: {
                name: "onebots",
                version: expect.any(String),
                instanceId: "inventory-instance",
            },
        });
        expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
        expect(report.complete).toBe(true);
        expect(report.errors).toEqual([]);
        expect(report.adapters.length).toBeGreaterThan(0);
        expect(report.adapters.find(adapter => adapter.name === "qq")).toMatchObject({
            source: "catalog",
            status: "verified",
            packageName: "@onebots/adapter-qq",
            packageVersion: expect.any(String),
            declared: true,
            capabilities: expect.any(Object),
        });
        expect(report.adapters.every(adapter => !("entryPath" in adapter))).toBe(true);
    });
});
