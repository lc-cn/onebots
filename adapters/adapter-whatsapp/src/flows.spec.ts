import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "waba",
    phone_number_id: "phone",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

const flow = {
    id: "flow-1",
    name: "lead_capture",
    categories: ["LEAD_GENERATION"],
    status: "DRAFT",
    validation_errors: [],
};

describe("WhatsAppFlows", () => {
    it("校验并返回 Flow 列表与分页", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({ data: [flow], paging: { cursors: { after: "next" } } }),
        );
        await expect(client.flows.list()).resolves.toMatchObject({
            data: [{ id: "flow-1", categories: ["LEAD_GENERATION"] }],
            paging: { cursors: { after: "next" } },
        });
    });

    it("以官方 multipart 创建 Flow 并闭合分类", async () => {
        const fetcher = jsonFetcher({ id: "flow-2" });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.flows.create({
                name: "onboarding",
                categories: ["SIGN_UP", "SIGN_IN"],
                endpoint_uri: "https://example.com/flows",
                clone_flow_id: "flow-1",
            }),
        ).resolves.toEqual({ id: "flow-2" });
        const form = requestForm(fetcher);
        expect(form.get("name")).toBe("onboarding");
        expect(form.get("categories")).toBe('["SIGN_UP","SIGN_IN"]');
        expect(form.get("clone_flow_id")).toBe("flow-1");
    });

    it("迁移指定 Flow 并校验逐项结果", async () => {
        const fetcher = jsonFetcher({
            migrated_flows: [
                { source_id: "source-1", source_name: "booking", migrated_id: "target-1" },
            ],
            failed_flows: [
                { source_name: "missing", error_code: "4233041", error_message: "not found" },
            ],
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.flows.migrate({
                source_waba_id: "source-waba",
                source_flow_names: ["booking", "missing"],
            }),
        ).resolves.toMatchObject({
            migrated_flows: [{ migrated_id: "target-1" }],
            failed_flows: [{ error_code: "4233041" }],
        });
        expect(requestForm(fetcher).get("source_flow_names")).toBe('["booking","missing"]');
    });

    it("用字段数组读取 Flow 完整控制面", async () => {
        const fetcher = jsonFetcher({
            ...flow,
            preview: { preview_url: "https://business.facebook.com/preview", expires_at: 42 },
            data_channel_uri: "https://example.com/data",
            health_status: {
                can_send_message: "AVAILABLE",
                entities: [{ entity_type: "FLOW", id: "flow-1", can_send_message: "AVAILABLE" }],
            },
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.flows.get("flow-1", ["id", "preview", "health_status"]),
        ).resolves.toMatchObject({
            id: "flow-1",
            health_status: { can_send_message: "AVAILABLE" },
        });
        expect(requestUrl(fetcher).searchParams.get("fields")).toBe("id,preview,health_status");
    });

    it("显式刷新预览 URL", async () => {
        const fetcher = jsonFetcher({
            id: "flow-1",
            preview: { preview_url: "https://business.facebook.com/preview", expires_at: 42 },
        });
        const client = new WhatsAppClient(config, fetcher);
        await client.flows.getPreview("flow-1", true);
        expect(requestUrl(fetcher).searchParams.get("fields")).toBe("preview.invalidate(true)");
        expect(requestUrl(fetcher).searchParams.get("date_format")).toBe("U");
    });

    it("构造受控 endpoint metric 表达式并校验数据点", async () => {
        const fetcher = jsonFetcher({
            id: "flow-1",
            metric: {
                name: "ENDPOINT_REQUEST_COUNT",
                granularity: "DAY",
                data_points: [
                    { timestamp: "2026-08-29T00:00:00+0000", data: [{ key: "value", value: 3 }] },
                ],
            },
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.flows.getMetric("flow-1", {
                name: "ENDPOINT_REQUEST_COUNT",
                granularity: "DAY",
                since: "2026-08-28",
                until: "2026-08-30",
            }),
        ).resolves.toMatchObject({ metric: { data_points: [{ data: [{ value: 3 }] }] } });
        expect(requestUrl(fetcher).searchParams.get("fields")).toBe(
            "metric.name(ENDPOINT_REQUEST_COUNT).granularity(DAY).since(2026-08-28).until(2026-08-30)",
        );
    });

    it("上传安全 JSON 资产并保留 Meta 校验错误", async () => {
        const fetcher = jsonFetcher({
            success: true,
            validation_errors: [validationError],
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.flows.updateJson("flow-1", {
                version: "7.1",
                screens: [{ id: "WELCOME", terminal: true }],
            }),
        ).resolves.toMatchObject({
            success: true,
            validation_errors: [{ error: "INVALID_PROPERTY" }],
        });
        const form = requestForm(fetcher);
        expect(form.get("asset_type")).toBe("FLOW_JSON");
        expect(await (form.get("file") as Blob).text()).toContain('"WELCOME"');
    });

    it("列出唯一受支持的 FLOW_JSON 资产", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({
                data: [
                    {
                        name: "flow.json",
                        asset_type: "FLOW_JSON",
                        download_url: "https://scontent.xx.fbcdn.net/flow.json",
                    },
                ],
            }),
        );
        await expect(client.flows.listAssets("flow-1")).resolves.toMatchObject({
            data: [{ asset_type: "FLOW_JSON" }],
        });
    });

    it.each([
        ["publish_flow", "POST", "/v23.0/flow-1/publish"],
        ["deprecate_flow", "POST", "/v23.0/flow-1/deprecate"],
        ["delete_flow", "DELETE", "/v23.0/flow-1"],
    ])("固定动作 %s 映射到不可逆生命周期接口", async (action, method, path) => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await executeWhatsAppPlatformAction(client, action, { flow_id: "flow-1" });
        expect(fetcher.mock.calls[0]?.[1]?.method).toBe(method);
        expect(requestUrl(fetcher).pathname).toBe(path);
    });

    it.each([
        ["非法分类", "create_flow", { flow: { name: "x", categories: ["UNKNOWN"] } }],
        ["字符串 fields", "get_flow", { flow_id: "flow-1", fields: "id" }],
        [
            "不安全 endpoint",
            "update_flow",
            { flow_id: "flow-1", flow: { endpoint_uri: "http://example.com" } },
        ],
        [
            "指标注入",
            "get_flow_metric",
            { flow_id: "flow-1", metric: { name: "COUNT)evil", granularity: "DAY" } },
        ],
        [
            "指标粒度",
            "get_flow_metric",
            {
                flow_id: "flow-1",
                metric: { name: "ENDPOINT_REQUEST_ERROR_RATE", granularity: "DAY" },
            },
        ],
        [
            "非法日期",
            "get_flow_metric",
            {
                flow_id: "flow-1",
                metric: {
                    name: "ENDPOINT_REQUEST_COUNT",
                    granularity: "DAY",
                    since: "2026-02-31",
                },
            },
        ],
    ])("拒绝 %s", async (_label, action, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it("拒绝循环 Flow JSON", async () => {
        const document: Record<string, unknown> = {};
        document.self = document;
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "update_flow_json", {
                flow_id: "flow-1",
                flow_json: document,
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("拒绝畸形 Flow 响应", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({ data: [{ ...flow, status: "PAUSED" }] }),
        );
        await expect(client.flows.list()).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });
});

const validationError = {
    error: "INVALID_PROPERTY",
    error_type: "JSON_SCHEMA_ERROR",
    message: "invalid property",
    line_start: 1,
    line_end: 1,
    column_start: 1,
    column_end: 2,
};

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): URL {
    return new URL(String(fetcher.mock.calls[0]?.[0]));
}

function requestForm(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): FormData {
    const body = fetcher.mock.calls[0]?.[1]?.body;
    if (!(body instanceof FormData)) throw new Error("期望请求体为 FormData");
    return body;
}
