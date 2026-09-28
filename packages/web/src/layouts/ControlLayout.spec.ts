import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { ControlStatus } from "@onebots/core/control";
import ControlLayout from "./ControlLayout.vue";

const status: ControlStatus = {
    schemaVersion: 1,
    manager: { id: "test", version: "1.0.0" },
    accounts: { available: true, items: [] },
    gateway: { desired: "stopped", actual: "stopped", recoveryRequired: false, operations: [] },
};

async function render(options: { statusError?: string; actionError?: string; inline?: boolean }) {
    const statusError = options.statusError ?? "";
    const actionError = options.actionError ?? "";
    return renderToString(
        createSSRApp(ControlLayout, {
            active: "accounts",
            state: status,
            error: actionError || statusError,
            statusError,
            actionError,
            inlineStatusError: options.inline ?? false,
            notice: "",
            isDark: false,
        }),
    );
}

describe("管理台错误分层", () => {
    it("账号页就地呈现状态故障时不重复显示全局告警", async () => {
        const html = await render({ statusError: "状态读取失败", inline: true });
        expect(html).toContain("管理状态待确认");
        expect(html).not.toContain("状态读取失败");
    });

    it("操作失败仍显示全局告警，但不把服务标成离线", async () => {
        const html = await render({ actionError: "撤销会话失败", inline: true });
        expect(html).toContain("撤销会话失败");
        expect(html).toContain("管理服务在线");
        expect(html).toContain("关闭");
        expect(html).not.toContain("管理状态待确认");
    });

    it("其他页面继续显示状态错误及重试操作", async () => {
        const html = await render({ statusError: "状态读取失败" });
        expect(html).toContain("状态读取失败");
        expect(html).toContain("重试");
    });
});
