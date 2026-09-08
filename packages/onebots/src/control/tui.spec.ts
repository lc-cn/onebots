import { describe, it, expect, vi } from "vitest";
import { ControlClient } from "@onebots/core/control";
import type { TuiPrompt, PromptRequest } from "../tui/prompt.js";
import { runControlInstallation, trackControlInstallation } from "./tui-installation.js";
import { runControlTui } from "./tui.js";

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
const catalog = {
    activeGenerationId: "base",
    selection: { adapters: ["icqq"], protocols: [], applications: [] },
    adapters: [{ name: "icqq", displayName: "ICQQ" }],
    protocols: [{ name: "onebot-v11", displayName: "OneBot" }],
    applications: [{ name: "zhin", displayName: "Zhin" }],
};
const plan = {
    id: "plan",
    packages: [{ name: "@onebots/adapter-icqq", version: "1.0.0" }],
    peers: [{ packageName: "@icqqjs/icqq", range: "^1", requestedBy: "@onebots/adapter-icqq" }],
    recommendations: ["可按需启用协议"],
};
function client(handler: (method: string, route: string, body: unknown) => unknown) {
    const request = vi.fn(
        async <T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> =>
            handler(method, route, body) as T,
    );
    return { client: new ControlClient({ request }), request };
}
describe("统一控制 TUI", () => {
    it("新设备授权走同一客户端，不恢复或启动网关", async () => {
        const ui = prompt([["device"], ["quit"]]);
        const transport = client(() => ({ code: "new-device-code" }));
        await runControlTui(transport.client, { prompt: ui.ui });
        expect(transport.request).toHaveBeenCalledExactlyOnceWith("POST", "/api/control/auth/device", {});
        expect(ui.reports.join(" ")).toContain("不撤销已有设备");
    });
    it("取消计划不安装，默认集合来自catalog，框架不补选协议", async () => {
        const ui = prompt([["icqq"], [], ["zhin"], ["no"]]);
        const transport = client((_method, route) => (route.endsWith("catalog") ? catalog : plan));
        await runControlInstallation(transport.client, ui.ui);
        expect(ui.requests[0].selected).toEqual(["icqq"]);
        expect(transport.request).toHaveBeenCalledWith("POST", "/api/control/installations/plan", {
            selection: { adapters: ["icqq"], protocols: [], applications: ["zhin"] },
            expectedGenerationId: "base",
        });
        expect(transport.request).toHaveBeenCalledTimes(2);
        expect(ui.requests[3].detail).toContain("必需依赖");
    });
    it("提交响应丢失只查原ID；隐藏token不输出，验证后独立确认激活", async () => {
        const ui = prompt([["icqq"], [], ["zhin"], ["yes"], ["secret-token"], ["yes"]]);
        const transport = client((_method, route) => {
            if (route.endsWith("catalog")) return catalog;
            if (route.endsWith("plan")) return plan;
            if (route === "/api/control/installations")
                throw new Error("secret-token: response lost");
            if (route === "/api/control/installations/same-id")
                return { phase: "verified", candidateId: "candidate" };
            if (route.endsWith("activate")) return { status: "succeeded" };
            throw new Error("unexpected route");
        });
        await runControlInstallation(transport.client, ui.ui, { requestId: () => "same-id" });
        expect(ui.requests[4].secret).toBe(true);
        expect(ui.reports.join(" ")).not.toContain("secret-token");
        expect(
            transport.request.mock.calls.filter(call => call[1] === "/api/control/installations"),
        ).toHaveLength(1);
        expect(transport.request).toHaveBeenCalledWith("POST", "/api/control/installations", {
            id: "same-id",
            planId: "plan",
            token: "secret-token",
        });
        expect(transport.request).toHaveBeenCalledWith(
            "GET",
            "/api/control/installations/same-id",
        );
        expect(transport.request).toHaveBeenCalledWith(
            "POST",
            "/api/control/generations/candidate/activate",
            {},
        );
    });
    it("取消结果未知仍查询同任务，不重复取消或激活失败任务", async () => {
        const ui = prompt([["cancel"]]);
        let reads = 0;
        const transport = client((_method, route) => {
            if (route.endsWith("cancel")) throw new Error("unknown");
            return { phase: ++reads === 1 ? "downloading" : "interrupted" };
        });
        await trackControlInstallation(transport.client, ui.ui, "existing", {
            wait: async () => {},
        });
        expect(transport.request.mock.calls.map(call => call[1])).toEqual([
            "/api/control/installations/existing",
            "/api/control/installations/existing/cancel",
            "/api/control/installations/existing",
        ]);
    });
    it("状态、生命周期和配置回调共用ControlClient，不触碰本地配置", async () => {
        const ui = prompt([["status"], ["start"], ["stop"], ["restart"], ["configure"], ["quit"]]);
        const onConfigure = vi.fn(async () => {});
        const transport = client((_method, route) =>
            route.endsWith("status")
                ? { gateway: { actual: "stopped", desired: "stopped" } }
                : { status: "succeeded" },
        );
        await runControlTui(transport.client, { prompt: ui.ui, onConfigure });
        expect(onConfigure).toHaveBeenCalledWith(transport.client, ui.ui);
        expect(transport.request.mock.calls.map(call => call[1])).toEqual([
            "/api/control/status",
            "/api/control/gateway/start",
            "/api/control/gateway/stop",
            "/api/control/gateway/restart",
        ]);
    });
});
