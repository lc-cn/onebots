import { createSSRApp } from "vue";
import { renderToString } from "vue/server-renderer";
import { describe, expect, it } from "vitest";
import type { ControlChatMessage } from "@onebots/core/control";
import AccountControlHistory from "./AccountControlHistory.vue";

async function render(
    options: {
        loading?: boolean;
        error?: string;
        enabled?: boolean;
        messages?: ControlChatMessage[];
    } = {},
) {
    return renderToString(
        createSSRApp(AccountControlHistory, {
            selected: { kind: "group", id: "test-group", name: "测试群" },
            messages: options.messages ?? [],
            loading: options.loading ?? false,
            error: options.error ?? "",
            enabled: options.enabled,
            hasMore: false,
            loadHistory: async () => {},
        }),
    );
}

describe("聊天记录展示", () => {
    it("键盘可聚焦记录区，关闭保存时明确表达空记录原因", async () => {
        const html = await render({ enabled: false });
        expect(html).toContain('role="log" tabindex="0"');
        expect(html).toContain("没有已保存的聊天记录；新消息不会保存。");
    });

    it("读取中或失败时不把尚未读取的记录说成空记录", async () => {
        const loading = await render({ loading: true });
        expect(loading).toContain("正在读取聊天记录");
        expect(loading).not.toContain("还没有聊天记录。");
        const failed = await render({ error: "历史读取失败" });
        expect(failed).not.toContain("还没有聊天记录。");
        expect(failed).not.toContain("正在读取聊天记录");
    });

    it("平台文本作为纯文本展示，发出消息以自己为发送方", async () => {
        const html = await render({
            messages: [
                {
                    id: 1,
                    platform: "mock",
                    accountId: "bot",
                    sceneType: "group",
                    sceneId: "test-group",
                    senderId: "bot",
                    senderName: "机器人",
                    direction: "outbound",
                    text: "<script>test</script>",
                    time: 1791430000000,
                },
            ],
        });
        expect(html).toContain("&lt;script&gt;test&lt;/script&gt;");
        expect(html).not.toContain("<script>");
        expect(html).toContain("<span>我</span>");
        expect(html).toContain('<time datetime="');
    });
});
