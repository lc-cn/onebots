import { describe, expect, it } from "vitest";
import {
    parseApiMessage,
    parseBusinessProfile,
    parseConversationList,
    parseSendResponse,
    parseUserProfile,
} from "./entities.js";

describe("Instagram Graph 响应校验", () => {
    it("解析 Professional Account、IGSID、发送结果和嵌套会话", () => {
        expect(parseBusinessProfile({ id: "100", username: "business" })).toEqual({
            id: "100",
            user_id: undefined,
            username: "business",
            name: undefined,
            profile_picture_url: undefined,
            account_type: undefined,
        });
        expect(
            parseUserProfile({
                id: "200",
                username: "customer",
                follower_count: 10,
                is_verified_user: false,
            }),
        ).toMatchObject({ id: "200", username: "customer", follower_count: 10 });
        expect(parseSendResponse({ recipient_id: "200", message_id: "m1" })).toEqual({
            recipient_id: "200",
            message_id: "m1",
        });
        expect(
            parseConversationList({
                data: [
                    {
                        id: "c1",
                        participants: { data: [{ id: "200", username: "customer" }] },
                        messages: {
                            data: [
                                {
                                    id: "m1",
                                    created_time: "2026-08-31T00:00:00+0000",
                                    from: { id: "200", username: "customer" },
                                    message: "hello",
                                },
                            ],
                            paging: { cursors: { after: "cursor" } },
                        },
                    },
                ],
            }).data[0],
        ).toMatchObject({
            id: "c1",
            participants: { data: [{ id: "200", username: "customer" }] },
            messages: { data: [{ id: "m1", message: "hello" }] },
        });
    });

    it("拒绝非数字 Meta ID、缺失 message_id、畸形列表与时间", () => {
        expect(() => parseBusinessProfile({ id: "business" })).toThrow(/Meta ID/u);
        expect(() => parseUserProfile({ id: 200 })).toThrow(/非空字符串/u);
        expect(() => parseSendResponse({ recipient_id: "200" })).toThrow(/message_id/u);
        expect(() => parseConversationList({ data: {} })).toThrow(/数组/u);
        expect(() => parseApiMessage({ id: "m1", created_time: 123, from: { id: "200" } })).toThrow(
            /created_time/u,
        );
    });
});
