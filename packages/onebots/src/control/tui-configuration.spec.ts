import { describe, it, expect, vi } from "vitest";
import { ControlClient, type ControlConfigurationDraft } from "@onebots/core/control";
import type { TuiPrompt, PromptRequest } from "../tui/prompt.js";
import { editControlFields } from "./tui-configuration-fields.js";
import { runControlConfiguration } from "./tui-configuration.js";
const base = { generationId: "generation", configRevision: "config" };
function initial(): ControlConfigurationDraft {
    return { id: "draft", revision: "r0", base, document: {}, secretStates: [], unknownPaths: [] };
}
function prompt(answers: string[][]) {
    const requests: PromptRequest[] = [];
    const reports: string[] = [];
    const ui: TuiPrompt = {
        ask: async request => {
            requests.push(request);
            const answer = answers.shift();
            if (!answer) throw new Error("unexpected prompt");
            return answer;
        },
        report: message => {
            reports.push(message);
        },
    };
    return { ui, requests, reports };
}
function transport(
    handler: (route: string, body: unknown) => unknown,
    source: () => unknown = () => ({ state: "ready", base }),
) {
    const request = vi.fn(
        async <T>(_method: "GET" | "POST", route: string, body?: unknown): Promise<T> => {
            if (route.endsWith("/source")) return source() as T;
            const result = handler(route, body);
            return (
                route.endsWith("/context") &&
                !(result && typeof result === "object" && "draft" in result)
                    ? { draft: result, schemas: {} }
                    : result
            ) as T;
        },
    );
    return { client: new ControlClient({ request }), request };
}
describe("TUI 配置草稿", () => {
    it("损坏源须明确确认私有备份与空修复，取消不写", async () => {
        for (const accepted of [false, true]) {
            const ui = prompt([
                ["new"],
                [accepted ? "yes" : "no"],
                ...(accepted ? [["back"]] : []),
            ]);
            const api = transport(
                () => ({ draft: initial(), schemas: {} }),
                () => ({ state: "damaged", base }),
            );
            await runControlConfiguration(api.client, ui.ui);
            expect(ui.requests[1].detail).toContain("私有备份");
            expect(api.request.mock.calls.some(call => call[1].endsWith("/repair-drafts"))).toBe(
                accepted,
            );
            expect(
                api.request.mock.calls.some(call => call[1] === "/api/control/configuration"),
            ).toBe(false);
        }
    });
    it("恢复修复草稿直接读取context，网络错误绝不假装源已损坏", async () => {
        const resumed = prompt([["resume"], ["draft"], ["back"]]);
        const api = transport(
            () => ({ draft: initial(), schemas: {} }),
            () => {
                throw new Error("source must not be called");
            },
        );
        await runControlConfiguration(api.client, resumed.ui);
        expect(api.request.mock.calls.map(call => call[1])).toEqual([
            "/api/control/configuration/drafts/draft/context",
        ]);
        const offline = prompt([["new"]]);
        const broken = transport(
            () => ({}),
            () => {
                throw new Error("network unavailable");
            },
        );
        await expect(runControlConfiguration(broken.client, offline.ui)).rejects.toThrow(
            "network unavailable",
        );
        expect(offline.requests).toHaveLength(1);
        expect(broken.request.mock.calls).toHaveLength(1);
    });
    it("对象列表通过专用API追加删除，嵌套秘密仅走secret操作", async () => {
        const ui = prompt([
            ["0"],
            ["append"],
            ["yes"],
            ["2"],
            ["set"],
            ["nested-private"],
            ["0"],
            ["remove"],
            ["0"],
            ["yes"],
            ["back"],
        ]);
        let draft = initial();
        const api = transport((route, body) => {
            const action = (body as { action?: string }).action;
            if (action === "append")
                draft = {
                    ...draft,
                    revision: "r1",
                    document: { rows: [{}] },
                    secretStates: [{ path: ["rows", "0", "token"], configured: false }],
                };
            else if (action === "remove")
                draft = { ...draft, revision: "r3", document: { rows: [] }, secretStates: [] };
            else
                draft = {
                    ...draft,
                    revision: "r2",
                    secretStates: [{ path: ["rows", "0", "token"], configured: true }],
                };
            return draft;
        });
        await editControlFields(
            api.client,
            ui.ui,
            draft,
            {
                rows: {
                    type: "array",
                    items: {
                        type: "object",
                        properties: {
                            name: { type: "string" },
                            token: { type: "string", sensitive: true },
                        },
                    },
                },
            },
            [],
        );
        expect(api.request.mock.calls.map(call => call[2])).toEqual([
            { expectedRevision: "r0", path: ["rows"], action: "append" },
            {
                expectedRevision: "r1",
                changes: [],
                secrets: [{ op: "set", path: ["rows", "0", "token"], value: "nested-private" }],
            },
            { expectedRevision: "r2", path: ["rows"], action: "remove", index: 0 },
        ]);
        expect(JSON.stringify(ui.requests) + ui.reports.join()).not.toContain("nested-private");
    });
    it("秘密只发送独立keep/set/clear，不预填或输出；每次使用新revision", async () => {
        const ui = prompt([
            ["0"],
            ["set"],
            ["private-token"],
            ["0"],
            ["keep"],
            ["0"],
            ["clear"],
            ["yes"],
            ["back"],
        ]);
        const draft = initial();
        draft.secretStates = [{ path: ["mock.bot", "token"], configured: true }];
        let revision = 0;
        const api = transport(() => ({ ...draft, revision: `r${++revision}` }));
        await editControlFields(
            api.client,
            ui.ui,
            draft,
            { token: { type: "string", sensitive: true } },
            ["mock.bot"],
        );
        const bodies = api.request.mock.calls.map(call => call[2]);
        expect(bodies).toEqual([
            {
                expectedRevision: "r0",
                changes: [],
                secrets: [{ op: "set", path: ["mock.bot", "token"], value: "private-token" }],
            },
            {
                expectedRevision: "r1",
                changes: [],
                secrets: [{ op: "keep", path: ["mock.bot", "token"] }],
            },
            {
                expectedRevision: "r2",
                changes: [],
                secrets: [{ op: "clear", path: ["mock.bot", "token"] }],
            },
        ]);
        expect(ui.requests[2].secret).toBe(true);
        expect(ui.requests[2].initial).toBeUndefined();
        expect(JSON.stringify(ui.requests) + ui.reports.join()).not.toContain("private-token");
    });
    it("添加账号不自动选择协议；明确启用、验证确认后应用，丢响应只查原ID", async () => {
        const ui = prompt([
            ["new"],
            ["add"],
            ["mock"],
            ["bot"],
            ["yes"],
            ["protocol"],
            ["account"],
            ["mock.bot"],
            ["onebot.v11"],
            ["enable"],
            ["yes"],
            ["validate"],
            ["yes"],
        ]);
        let draft = initial();
        const api = transport((route, body) => {
            if (route === "/api/control/configuration")
                return {
                    base,
                    schemas: { adapters: { mock: {} }, protocols: { "onebot.v11": {} } },
                };
            if (route.endsWith("drafts")) return draft;
            if (route.endsWith("accounts"))
                return (draft = { ...draft, revision: "r1", document: { "mock.bot": {} } });
            if (route.endsWith("protocol"))
                return (draft = {
                    ...draft,
                    revision: "r2",
                    document: { "mock.bot": { "onebot.v11": {} } },
                });
            if (route.endsWith("validate"))
                return { valid: true, issues: [], receiptId: "receipt", draftRevision: "r2" };
            if (route.endsWith("apply")) throw new Error("response lost with private content");
            if (route.includes("operations/")) return { status: "succeeded", phase: "completed" };
            throw new Error("unexpected");
        });
        await runControlConfiguration(api.client, ui.ui);
        const writes = api.request.mock.calls.filter(call => call[0] === "POST");
        expect(writes.filter(call => call[1].endsWith("protocol"))).toHaveLength(1);
        expect(writes.find(call => call[1].endsWith("accounts"))?.[2]).toEqual({
            expectedRevision: "r0",
            platform: "mock",
            accountId: "bot",
        });
        const apply = writes.filter(call => call[1].endsWith("apply"));
        expect(apply).toHaveLength(1);
        const request = apply[0][2] as { id: string; receiptId: string };
        expect(request.receiptId).toBe("receipt");
        expect(
            api.request.mock.calls.some(call => call[1].endsWith(`operations/${request.id}`)),
        ).toBe(true);
        expect(ui.reports.join()).not.toContain("private content");
    });
    it("验证失败不应用，不回显第三方诊断中的secret", async () => {
        const ui = prompt([["new"], ["validate"], ["back"]]);
        const api = transport(route =>
            route === "/api/control/configuration"
                ? { base, schemas: {} }
                : route.endsWith("validate")
                  ? { valid: false, issues: [{ path: [], message: "secret-diagnostic" }] }
                  : initial(),
        );
        await runControlConfiguration(api.client, ui.ui);
        expect(api.request.mock.calls.some(call => call[1].endsWith("apply"))).toBe(false);
        expect(ui.reports.join()).not.toContain("secret-diagnostic");
    });
    it("取消应用确认保持草稿，不提交", async () => {
        const ui = prompt([["resume"], ["draft"], ["validate"], ["no"], ["back"]]);
        const api = transport(route =>
            route === "/api/control/configuration"
                ? { base, schemas: {} }
                : route.endsWith("validate")
                  ? { valid: true, receiptId: "receipt", draftRevision: "r0", issues: [] }
                  : initial(),
        );
        await runControlConfiguration(api.client, ui.ui);
        expect(api.request.mock.calls.some(call => call[1].endsWith("apply"))).toBe(false);
    });
});
