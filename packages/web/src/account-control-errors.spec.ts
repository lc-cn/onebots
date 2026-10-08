import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlRequestError } from "@onebots/core/control";
import { friend, group, mountControl, result } from "./account-control-test-fixture.js";

afterEach(() => vi.unstubAllGlobals());

describe("账号控制可操作错误提示", () => {
    it("列表保留服务端运行版本提示，未知异常使用本地兜底", async () => {
        let failed = 0;
        const hint = "当前运行版本不支持账号查询，请升级并激活运行版本";
        const fixture = mountControl({
            explore: async () => {
                if (!failed++) throw new ControlRequestError(503, hint);
                throw new TypeError("private-client-value");
            },
        });
        try {
            await vi.waitFor(() => expect(fixture.control.sendCapabilityLoading.value).toBe(false));
            fixture.control.category.value = "friend";
            await vi.waitFor(() =>
                expect(fixture.control.visibleList.value.error).toContain("重试"),
            );
            expect(fixture.control.visibleList.value.error).not.toContain("private-client-value");
        } finally {
            fixture.close();
        }
        const serverFixture = mountControl({
            explore: async () => {
                throw new ControlRequestError(503, hint);
            },
        });
        try {
            serverFixture.control.category.value = "friend";
            await vi.waitFor(() =>
                expect(serverFixture.control.visibleList.value.error).toBe(hint),
            );
        } finally {
            serverFixture.close();
        }
    });

    it("详情与成员各自展示服务端故障，不覆盖可用的会话列表", async () => {
        const detailHint = "平台读取账号资料失败，请查看网关日志中的账号查询记录";
        const memberHint = "账号查询繁忙，请等待已有查询结束";
        const fixture = mountControl({
            explore: async request => {
                if (request.action === "detail") throw new ControlRequestError(502, detailHint);
                if (request.action === "members") throw new ControlRequestError(429, memberHint);
                return result(request, { items: [friend] });
            },
        });
        try {
            await fixture.control.choose(group);
            await vi.waitFor(() => expect(fixture.control.memberError.value).toBe(memberHint));
            expect(fixture.control.detailError.value).toBe(detailHint);
            expect(fixture.control.selected.value).toEqual(group);
        } finally {
            fixture.close();
        }
    });

    it("历史和最近会话保留管理服务提示", async () => {
        const hint = "聊天历史存储暂不可用，请检查数据目录";
        const fixture = mountControl({
            history: async () => {
                throw new ControlRequestError(503, hint);
            },
            conversations: async () => {
                throw new ControlRequestError(503, hint);
            },
        });
        try {
            await vi.waitFor(() => expect(fixture.control.recent.value.error).toBe(hint));
            await fixture.control.choose(friend);
            await vi.waitFor(() => expect(fixture.control.historyError.value).toBe(hint));
        } finally {
            fixture.close();
        }
    });
});
