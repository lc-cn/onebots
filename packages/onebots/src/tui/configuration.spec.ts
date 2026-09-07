import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAccounts } from "./configuration.js";
import { editSchema } from "./form.js";
import { AdapterRegistry, ProtocolRegistry } from "@onebots/core";
import { TuiCancelled, type TuiPrompt, type PromptRequest } from "./prompt.js";

afterEach(() => vi.restoreAllMocks());
function promptFor(
    answers: Array<string[] | Error>,
    inspect?: (request: PromptRequest) => void,
): TuiPrompt {
    return {
        report: vi.fn(),
        ask: vi.fn(async request => {
            inspect?.(request);
            const answer = answers.shift();
            if (!answer) throw new Error("测试回答不足：" + request.title);
            if (answer instanceof Error) throw answer;
            return answer;
        }),
    };
}
describe("工作台表单与共享账号草稿", () => {
    it("独立编辑账号和协议，未确认保存前不写文件", async () => {
        vi.spyOn(AdapterRegistry, "getSchema").mockReturnValue({
            account_id: { type: "string", required: true },
            token: { type: "string", required: true, sensitive: true },
        });
        vi.spyOn(ProtocolRegistry, "getSchema").mockReturnValue({
            http: { type: "boolean", default: true },
            access_token: { type: "string", sensitive: true },
        });
        const config = {};
        const selection = { adapters: ["telegram"], protocols: ["onebot-v11"] };
        await configureAccounts(
            promptFor([
                ["add:telegram"],
                ["account_id"],
                ["bot"],
                ["token"],
                ["platform-secret"],
                ["$done"],
                ["$done"],
            ]),
            config,
            selection,
        );
        expect(config).toEqual({ "telegram.bot": { token: "platform-secret" } });
        await configureAccounts(
            promptFor([
                ["edit:telegram.bot"],
                ["onebot-v11"],
                ["edit"],
                ["access_token"],
                ["protocol-secret"],
                ["$done"],
                ["$done"],
                ["$done"],
            ]),
            config,
            selection,
            true,
        );
        expect(config).toEqual({
            "telegram.bot": {
                token: "platform-secret",
                "onebot.v11": { http: true, access_token: "protocol-secret" },
            },
        });
    });
    it("凭据只显示状态，依赖字段随取值更新", async () => {
        const requests: PromptRequest[] = [];
        const result = await editSchema(
            promptFor([["token"], [""], ["mode"], ["1"], ["port"], ["8080"], ["$done"]], request =>
                requests.push(request),
            ),
            {
                token: { type: "string", sensitive: true, required: true },
                mode: {
                    type: "string",
                    choices: [
                        { label: "轮询", value: "polling" },
                        { label: "回调", value: "webhook" },
                    ],
                },
                port: { type: "number", ui: { visibleWhen: { path: "mode", oneOf: ["webhook"] } } },
            },
            { token: "existing-secret", mode: "polling" },
            "test",
        );
        expect(result).toEqual({ token: "existing-secret", mode: "webhook", port: 8080 });
        expect(JSON.stringify(requests)).not.toContain("existing-secret");
        expect(requests[0].choices?.map(item => item.value)).not.toContain("port");
        expect(requests[4].choices?.map(item => item.value)).toContain("port");
    });
    it("字段取消保留已完成编辑，离开表单明确选择保留", async () => {
        const result = await editSchema(
            promptFor([
                ["name"],
                ["changed"],
                ["port"],
                new TuiCancelled(),
                new TuiCancelled(),
                ["done"],
            ]),
            { name: { type: "string" }, port: { type: "number" } },
            { name: "old" },
            "编辑",
        );
        expect(result).toEqual({ name: "changed" });
    });
    it("校验错误不会显示敏感输入", async () => {
        const prompt = promptFor([["token"], ["bad-secret"], ["good-secret"], ["$done"]]);
        const result = await editSchema(
            prompt,
            { token: { type: "string", sensitive: true, pattern: /^good-/ } },
            {},
            "test",
        );
        expect(result.token).toBe("good-secret");
        expect(JSON.stringify(vi.mocked(prompt.report).mock.calls)).not.toContain("bad-secret");
    });
});
