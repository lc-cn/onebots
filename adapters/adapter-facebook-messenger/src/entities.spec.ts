import { describe, expect, it } from "vitest";
import {
    parseApiMessage,
    parseConversationList,
    parsePageProfile,
    parseSendResponse,
    parseUserProfile,
} from "./entities.js";

describe("Facebook Messenger Graph 响应校验", () => {
    it("解析 Page、PSID、发送结果和嵌套会话", () => {
        expect(parsePageProfile({ id: "100", name: "Page" })).toEqual({
            id: "100",
            name: "Page",
            picture: undefined,
        });
        expect(parseUserProfile({ id: "200", name: "User", timezone: 8 })).toMatchObject({
            id: "200",
            name: "User",
            timezone: 8,
        });
        expect(parseSendResponse({ recipient_id: "200", message_id: "m1" })).toEqual({
            recipient_id: "200",
            message_id: "m1",
        });
        expect(
            parseConversationList({
                data: [
                    {
                        id: "t_100",
                        participants: { data: [{ id: "200", name: "User" }] },
                        messages: {
                            data: [
                                {
                                    id: "m1",
                                    created_time: "2026-08-31T00:00:00+0000",
                                    from: { id: "200", name: "User" },
                                    message: "hello",
                                },
                            ],
                            paging: { cursors: { after: "cursor" } },
                        },
                    },
                ],
            }).data[0],
        ).toMatchObject({
            id: "t_100",
            participants: { data: [{ id: "200", name: "User" }] },
            messages: { data: [{ id: "m1", message: "hello" }] },
        });
    });

    it("拒绝非数字 Page/PSID、缺失列表与畸形消息", () => {
        expect(() => parsePageProfile({ id: "page", name: "Page" })).toThrow(/Meta ID/u);
        expect(() => parseUserProfile({ id: 200 })).toThrow(/非空字符串/u);
        expect(() => parseSendResponse({ recipient_id: "user" })).toThrow(/Meta ID/u);
        expect(() => parseConversationList({ data: {} })).toThrow(/数组/u);
        expect(() => parseApiMessage({ id: "m1", created_time: 123, from: { id: "200" } })).toThrow(
            /created_time/u,
        );
    });
});
