import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import ControlConfigurationImpact from "./ControlConfigurationImpact.vue";
import type { ConfigurationImpact } from "./control-configuration-impact.js";
import {
    configurationImpactSummary,
    configurationOperationMessage,
} from "./control-configuration-impact.js";

const impact: ConfigurationImpact = {
    mode: "hot",
    accounts: [],
    protocols: [
        { platform: "mock", accountId: "<bot>", name: "onebot", version: "v11", action: "replace" },
    ],
    dynamicFields: [],
    restartReasons: [],
};

describe("配置影响的渐进披露", () => {
    it("新增和移除协议不混称更新", () => {
        expect(
            configurationImpactSummary({
                ...impact,
                protocols: [
                    { ...impact.protocols[0], action: "add" },
                    { ...impact.protocols[0], action: "remove" },
                ],
            }),
        ).toBe("新增协议出口 1 项 · 移除协议出口 1 项");
    });
    it("无有效变化优先于存储模式，不承诺待生效变更", () => {
        expect(
            configurationOperationMessage({
                id: "operation",
                validationId: "receipt",
                status: "succeeded",
                phase: "completed",
                recoveryRequired: false,
                executionMode: "stored",
                impact: { ...impact, mode: "none" },
            }),
        ).toBe("配置没有变化，连接保持原状。");
    });
    it("仅保存的配置不冒充已应用", async () => {
        const html = await renderToString(
            createSSRApp(ControlConfigurationImpact, { impact, applied: true, stored: true }),
        );
        expect(html).toContain("待生效配置范围");
        expect(html).toContain("已保存，待生效");
        expect(html).not.toContain("上次应用");
    });
    it("摘要显示协议数量，身份在可键盘展开的原生详情内作为纯文本展示", async () => {
        const html = await renderToString(createSSRApp(ControlConfigurationImpact, { impact }));
        expect(html).toContain("更新协议出口 1 项");
        expect(html).toContain("其他账号保持连接");
        expect(html).toMatch(/<details[^>]*>/);
        expect(html).not.toMatch(/<details[^>]*\bopen\b/);
        expect(html).toMatch(/<summary[^>]*>查看影响范围<\/summary>/);
        expect(html).toContain("&lt;bot&gt;");
        expect(html).not.toContain("<bot>");
    });
    it("已完成重启展示过去结果，不再要求用户再次重启", async () => {
        const html = await renderToString(
            createSSRApp(ControlConfigurationImpact, {
                impact: { ...impact, mode: "restart", restartReasons: ["port"] },
                applied: true,
            }),
        );
        expect(html).toContain("上次应用范围");
        expect(html).toContain("网关已重新启动并应用配置");
        expect(html).not.toContain("需要重启网关");
    });
});
