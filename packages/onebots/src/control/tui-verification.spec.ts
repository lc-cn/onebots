import { describe, it, expect, vi } from "vitest";
import { ControlClient } from "@onebots/core/control";
import type { PromptRequest, TuiPrompt } from "../tui/prompt.js";
import {
    runControlVerification,
    queryControlVerification,
    verificationTerminalText,
} from "./tui-verification.js";

const challengeId = "12345678-1234-4234-8234-123456789012";
const gatewayInstanceId = "22345678-1234-4234-8234-123456789012";
const receipt = {
    challengeId,
    gatewayInstanceId,
    configVersion: "v1",
    action: "submit",
    startedAt: "2026-09-09T00:00:00.000Z",
    finishedAt: "2026-09-09T00:00:01.000Z",
};
function fixture(answers: string[], fail = false, sms = false) {
    const reports: string[] = [];
    const asks: PromptRequest[] = [];
    const prompt: TuiPrompt = {
        report: value => {
            reports.push(value);
        },
        ask: async request => {
            asks.push(request);
            const value = answers.shift();
            if (value === undefined) throw new Error("unexpected prompt");
            return [value];
        },
    };
    const request = vi.fn(
        async <T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> => {
            if (route.endsWith("pending"))
                return {
                    gatewayInstanceId,
                    configVersion: "v1",
                    challenges: [
                        {
                            id: challengeId,
                            createdAt: Date.now(),
                            expiresAt: Date.now() + 60000,
                            request: {
                                platform: "test",
                                account_id: "bot",
                                type: "code",
                                hint: "请输入验证码",
                                requestSmsAvailable: sms,
                                options: {
                                    blocks: [
                                        { type: "input", key: "code", secret: false },
                                        { type: "link", url: "javascript:alert(1)" },
                                    ],
                                },
                            },
                        },
                    ],
                } as T;
            if (method === "POST") {
                expect(reports.join(" ")).toContain("请保存验证操作 ID");
                if (fail) throw new Error("sensitive platform error");
                return {
                    ...receipt,
                    id: (body as { operationId: string }).operationId,
                    status: "succeeded",
                } as T;
            }
            return { ...receipt, id: challengeId, status: "unknown" } as T;
        },
    );
    return { prompt, asks, reports, request, client: new ControlClient({ request }) };
}
describe("管理端账号验证 TUI", () => {
    it("隐藏所有答案，派发前显示回执 ID，并绑定挑战和版本", async () => {
        const f = fixture([challengeId, "submit", "secret-code", "yes"]);
        await runControlVerification(f.client, f.prompt);
        const sent = f.request.mock.calls.find(call => call[0] === "POST");
        expect(sent?.[2]).toMatchObject({
            challengeId,
            expected: { gatewayInstanceId, configVersion: "v1" },
            action: "submit",
        });
        expect(f.asks.find(item => item.secret)).toBeDefined();
        expect(f.reports.join(" ")).not.toContain("secret-code");
        expect(f.reports.join(" ")).not.toContain("javascript:");
        expect(f.reports.join(" ")).toContain("不代表账号已登录");
    });
    it("短信响应丢失不重发，不查询或输出平台异常", async () => {
        const f = fixture([challengeId, "sms", "yes"], true, true);
        await runControlVerification(f.client, f.prompt);
        expect(f.request.mock.calls.filter(call => call[0] === "POST")).toHaveLength(1);
        expect(f.request.mock.calls[1][2]).toMatchObject({ action: "request-sms" });
        expect(f.request.mock.calls[1][2]).not.toHaveProperty("data");
        expect(f.reports.join(" ")).toContain("不要重新提交");
        expect(f.reports.join(" ")).not.toContain("sensitive platform error");
    });
    it("取消不会派发；查询回执无需网关状态或挑战", async () => {
        const cancelled = fixture([challengeId, "submit", "code", "no"]);
        await runControlVerification(cancelled.client, cancelled.prompt);
        expect(cancelled.request).toHaveBeenCalledTimes(1);
        const f = fixture([challengeId, "no"]);
        await queryControlVerification(f.client, f.prompt);
        expect(f.request).toHaveBeenCalledExactlyOnceWith(
            "GET",
            `/api/control/verification/operations/${challengeId}`,
        );
        expect(f.reports.join(" ")).toContain("结果未确认");
    });
    it("平台文本不能包含终端控制序列", () => {
        expect(verificationTerminalText("a\x1b[31mred\x1b[0m\x1b]52;c;secret\x07\r\n\x9b")).toBe(
            "ared   ",
        );
    });
});

it("查询未知回执后明确确认才对账，不重新收集答案", async () => {
    const f = fixture([challengeId, "yes"]);
    f.request.mockImplementation(
        async <T>(_method: "GET" | "POST", route: string): Promise<T> =>
            ({
                ...receipt,
                id: challengeId,
                status: "unknown",
                ...(route.endsWith("reconcile")
                    ? {
                          resolution: {
                              outcome: "succeeded",
                              confirmedAt: "2026-09-09T00:00:02.000Z",
                          },
                      }
                    : {}),
            }) as T,
    );
    await queryControlVerification(f.client, f.prompt);
    expect(f.request.mock.calls).toEqual([
        ["GET", `/api/control/verification/operations/${challengeId}`],
        ["POST", "/api/control/verification/reconcile", { id: challengeId }],
    ]);
    expect(f.asks).toHaveLength(2);
    expect(f.reports.join(" ")).toContain("不代表账号已登录");
});

it.each(["no", "yes"])("接受未知风险另需确认 %s，不停止网关或重提", async accepted => {
    const f = fixture([challengeId, "acknowledge", accepted]);
    f.request.mockImplementation(
        async <T>(_method: "GET" | "POST", route: string): Promise<T> =>
            ({
                ...receipt,
                id: challengeId,
                status: "unknown",
                ...(route.endsWith("acknowledge")
                    ? { acknowledgement: { acceptedAt: "2026-09-09T00:00:02.000Z" } }
                    : {}),
            }) as T,
    );
    await queryControlVerification(f.client, f.prompt);
    expect(f.asks).toHaveLength(3);
    expect(f.asks[2].detail).toContain("可能已经执行");
    expect(f.request.mock.calls).toEqual([
        ["GET", `/api/control/verification/operations/${challengeId}`],
        ...(accepted === "yes"
            ? [
                  [
                      "POST",
                      "/api/control/verification/acknowledge",
                      { id: challengeId, acceptUnknownOutcome: true },
                  ],
              ]
            : []),
    ]);
    if (accepted === "yes") expect(f.reports.join(" ")).toContain("不代表执行成功");
});
