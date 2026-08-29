import { describe, expect, test } from "vitest";
import { WeComKfClient } from "./client.js";

describe("微信客服运行时配置", () => {
    test("manual 模式不要求回调凭据", () => {
        const client = new WeComKfClient({
            account_id: "bot",
            corp_id: "ww-corp",
            corp_secret: "secret",
            receive_mode: "manual",
        });
        expect(client.receiveMode).toBe("manual");
    });

    test("Webhook 模式闭合回调凭据与 AES Key", () => {
        expect(
            () =>
                new WeComKfClient({
                    account_id: "bot",
                    corp_id: "ww-corp",
                    corp_secret: "secret",
                }),
        ).toThrow(/token 和 encoding_aes_key/u);
        expect(
            () =>
                new WeComKfClient({
                    account_id: "bot",
                    corp_id: "ww-corp",
                    corp_secret: "secret",
                    token: "token",
                    encoding_aes_key: "short",
                }),
        ).toThrow(/43 位/u);
    });

    test("补偿轮询必须绑定客服账号", () => {
        expect(
            () =>
                new WeComKfClient({
                    account_id: "bot",
                    corp_id: "ww-corp",
                    corp_secret: "secret",
                    receive_mode: "manual",
                    enable_sync_poll: true,
                }),
        ).toThrow(/open_kfid/u);
    });
});
