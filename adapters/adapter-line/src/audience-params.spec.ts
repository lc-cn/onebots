import { describe, expect, it } from "vitest";
import {
    addAudienceRequest,
    audienceFile,
    audienceListQuery,
    createAudienceRequest,
    createClickAudienceRequest,
    createImpressionAudienceRequest,
    updateAudienceDescriptionRequest,
} from "./audience-params.js";

describe("LINE Audience 参数", () => {
    it("闭合 JSON 上传与追加请求", () => {
        expect(
            createAudienceRequest({
                request: {
                    description: "客户",
                    isIfaAudience: false,
                    uploadDescription: "首批",
                    audiences: [{ id: "U1" }, { id: "U2" }],
                },
            }),
        ).toEqual({
            description: "客户",
            isIfaAudience: false,
            uploadDescription: "首批",
            audiences: [{ id: "U1" }, { id: "U2" }],
        });
        expect(
            addAudienceRequest({
                request: { audienceGroupId: 7, audiences: [{ id: "U3" }] },
            }),
        ).toEqual({
            audienceGroupId: 7,
            uploadDescription: undefined,
            audiences: [{ id: "U3" }],
        });
    });

    it("闭合点击、曝光与重命名请求", () => {
        expect(
            createClickAudienceRequest({
                request: {
                    description: "点击客户",
                    requestId: "request-1",
                    clickUrl: "https://example.test/campaign",
                },
            }),
        ).toEqual({
            description: "点击客户",
            requestId: "request-1",
            clickUrl: "https://example.test/campaign",
        });
        expect(
            createImpressionAudienceRequest({
                request: { description: "曝光客户", requestId: "request-2" },
            }),
        ).toEqual({ description: "曝光客户", requestId: "request-2" });
        expect(
            updateAudienceDescriptionRequest({
                audience_group_id: 7,
                request: { description: "新名称" },
            }),
        ).toEqual({ description: "新名称" });
    });

    it("按官方范围解析列表条件并接纳当前来源枚举", () => {
        expect(
            audienceListQuery(
                {
                    page: 1,
                    size: 40,
                    status: "READY",
                    create_route: "BUSINESS_MANAGER",
                    includes_owned_audience_groups: true,
                },
                true,
            ),
        ).toEqual({
            page: 1,
            description: undefined,
            status: "READY",
            size: 40,
            createRoute: "BUSINESS_MANAGER",
            includeExternal: undefined,
            includeOwned: true,
        });
    });

    it("文件上传强制 text/plain 且拒绝伪 Base64", async () => {
        const blob = audienceFile(
            { data_base64: Buffer.from("U1\nU2\n").toString("base64"), description: "客户" },
            "create",
        );
        expect(blob.type).toBe("text/plain");
        await expect(blob.text()).resolves.toBe("U1\nU2\n");
        expect(() =>
            audienceFile({ data_base64: "not-base64", description: "客户" }, "create"),
        ).toThrow("必须是规范 Base64");
        expect(() =>
            audienceFile(
                {
                    data_base64: "VTE=",
                    description: "客户",
                    content_type: "application/json",
                },
                "create",
            ),
        ).toThrow("不接受参数 content_type");
    });

    it.each([
        ["未知外层字段", () => createAudienceRequest({ request: {}, typo: true })],
        [
            "未知请求字段",
            () =>
                createAudienceRequest({
                    request: { description: "客户", audiences: [{ id: "U1" }], typo: true },
                }),
        ],
        [
            "未知受众字段",
            () =>
                createAudienceRequest({
                    request: { description: "客户", audiences: [{ id: "U1", name: "x" }] },
                }),
        ],
        ["非正数 ID", () => addAudienceRequest({ request: { audienceGroupId: 0 } })],
        [
            "空受众",
            () => createAudienceRequest({ request: { description: "客户", audiences: [] } }),
        ],
        ["越界分页", () => audienceListQuery({ page: 1, size: 41 }, false)],
        ["未知状态", () => audienceListQuery({ page: 1, status: "UNKNOWN" }, false)],
        ["未知来源", () => audienceListQuery({ page: 1, create_route: "UNKNOWN" }, false)],
    ])("拒绝%s", (_label, action) => {
        expect(action).toThrow(expect.objectContaining({ code: "LINE_INVALID_ACTION_PARAMS" }));
    });
});
