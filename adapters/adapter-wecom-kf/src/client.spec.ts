import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WeComKfClient } from "./client.js";
import type { WeComKfConfig } from "./types.js";

const config: WeComKfConfig = {
    account_id: "kf",
    corp_id: "ww-corp",
    corp_secret: "secret",
    token: "token",
    encoding_aes_key: Buffer.alloc(32, 1).toString("base64").slice(0, 43),
};
const json = (value: unknown, status = 200) =>
    new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
    });
const temporaryFiles: string[] = [];

afterEach(async () => {
    await Promise.all(temporaryFiles.splice(0).map(path => rm(path, { force: true })));
});

describe("WeComKfClient", () => {
    it("并发 start 共享初始化且 stop 取消在途同步", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockImplementationOnce(
                (_input, init) =>
                    new Promise<Response>((_resolve, reject) => {
                        init?.signal?.addEventListener("abort", () =>
                            reject(new DOMException("aborted", "AbortError")),
                        );
                    }),
            );
        const client = new WeComKfClient(config, fetcher);
        const ready = vi.fn();
        client.on("ready", ready);

        await Promise.all([client.start(), client.start()]);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(ready).toHaveBeenCalledTimes(1);

        const synchronization = client.synchronize("wk-1");
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
        client.stop();
        await expect(synchronization).rejects.toMatchObject({ code: "WECOM_KF_ABORTED" });
    });

    it("快速重启时旧初始化不会覆盖新生命周期", async () => {
        let resolveOldToken: (response: Response) => void = () => undefined;
        const fetcher = vi
            .fn<typeof fetch>()
            .mockImplementationOnce(
                () =>
                    new Promise<Response>(resolve => {
                        resolveOldToken = resolve;
                    }),
            )
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "new", expires_in: 7200 }),
            );
        const client = new WeComKfClient(config, fetcher);

        const oldStart = client.start();
        await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
        client.stop();
        await client.start();

        const oldResult = expect(oldStart).rejects.toMatchObject({ code: "WECOM_KF_ABORTED" });
        resolveOldToken(json({ errcode: 0, errmsg: "ok", access_token: "old", expires_in: 7200 }));
        await oldResult;
        await expect(client.getAccessToken()).resolves.toBe("new");
        expect(fetcher).toHaveBeenCalledTimes(2);
        client.stop();
    });

    it("并发请求只获取一次 access_token", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValue(
                json({ errcode: 0, errmsg: "ok", access_token: "shared", expires_in: 7200 }),
            );
        const client = new WeComKfClient(config, fetcher);
        await expect(
            Promise.all([client.getAccessToken(), client.getAccessToken()]),
        ).resolves.toEqual(["shared", "shared"]);
        expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("凭证失效时只刷新一次并重试原请求", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "old", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 40014, errmsg: "invalid token" }))
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "new", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 0, errmsg: "ok", value: 1 }));
        const client = new WeComKfClient(config, fetcher);

        await expect(client.call({ path: "/cgi-bin/kf/example" })).resolves.toEqual(
            expect.objectContaining({ value: 1 }),
        );
        expect(String(fetcher.mock.calls[1]?.[0])).toContain("access_token=old");
        expect(String(fetcher.mock.calls[3]?.[0])).toContain("access_token=new");
    });

    it("区分无效 JSON 与素材接口返回的平台错误", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(new Response("not-json", { status: 200 }))
            .mockResolvedValueOnce(json({ errcode: 93000, errmsg: "media invalid" }));
        const client = new WeComKfClient(config, fetcher);

        await expect(client.call({ path: "/cgi-bin/kf/example" })).rejects.toMatchObject({
            code: "WECOM_KF_INVALID_RESPONSE",
        });
        await expect(
            client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: "missing" },
                response_type: "buffer",
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_93000" });
    });

    it("拒绝缺少官方响应 envelope 的 JSON", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ value: 1 }));
        const client = new WeComKfClient(config, fetcher);

        await expect(client.call({ path: "/cgi-bin/kf/example" })).rejects.toMatchObject({
            code: "WECOM_KF_INVALID_RESPONSE",
            path: "/cgi-bin/kf/example",
        });
    });

    it("分页同步、去重、分发并原子持久化游标", async () => {
        const cursorPath = `/tmp/onebots-wecom-kf-${process.pid}-${Date.now()}.json`;
        temporaryFiles.push(cursorPath);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(
                json({
                    errcode: 0,
                    errmsg: "ok",
                    next_cursor: "c2",
                    has_more: 1,
                    msg_list: [{ msgid: "m1", msgtype: "text", text: { content: "one" } }],
                }),
            )
            .mockResolvedValueOnce(
                json({
                    errcode: 0,
                    errmsg: "ok",
                    next_cursor: "c3",
                    has_more: 0,
                    msg_list: [
                        { msgid: "m1", msgtype: "text", text: { content: "duplicate" } },
                        { msgid: "m2", msgtype: "text", text: { content: "two" } },
                    ],
                }),
            );
        const client = new WeComKfClient({ ...config, cursor_store_path: cursorPath }, fetcher);
        const delivered = vi.fn();
        client.on("kf_item", delivered);
        await expect(client.synchronize("wk-1", "callback-token")).resolves.toHaveLength(2);
        expect(delivered).toHaveBeenCalledTimes(2);
        await expect(readFile(cursorPath, "utf8")).resolves.toContain('"wk-1": "c3"');
    });

    it("业务监听器异常时保留游标，重投成功后才提交", async () => {
        const cursorPath = `/tmp/onebots-wecom-kf-listener-${process.pid}-${Date.now()}.json`;
        temporaryFiles.push(cursorPath);
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(
                json({
                    errcode: 0,
                    errmsg: "ok",
                    next_cursor: "committed",
                    has_more: 0,
                    msg_list: [{ msgid: "m1", msgtype: "text", text: { content: "one" } }],
                }),
            )
            .mockResolvedValueOnce(
                json({
                    errcode: 0,
                    errmsg: "ok",
                    next_cursor: "committed",
                    has_more: 0,
                    msg_list: [{ msgid: "m1", msgtype: "text", text: { content: "one" } }],
                }),
            );
        const client = new WeComKfClient({ ...config, cursor_store_path: cursorPath }, fetcher);
        const delivered = vi.fn();
        let attempts = 0;
        client.on("raw_event", () => {
            attempts += 1;
            if (attempts === 1) throw new Error("observer failed");
        });
        client.on("kf_item", delivered);

        await expect(client.synchronize("wk-1")).rejects.toMatchObject({
            code: "WECOM_KF_EVENT_DELIVERY_FAILED",
        });
        await expect(readFile(cursorPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
        await expect(client.synchronize("wk-1")).resolves.toHaveLength(1);

        expect(delivered).toHaveBeenCalledTimes(1);
        expect(attempts).toBe(2);
        await expect(readFile(cursorPath, "utf8")).resolves.toContain('"wk-1": "committed"');
    });

    it("从系统事件内层发现真实客服账号身份", () => {
        const client = new WeComKfClient(config);

        client.ingest({
            msgtype: "event",
            event: { event_type: "enter_session", open_kfid: "wk-event" },
        });
        client.ingestCallback({
            MsgType: "event",
            Event: "kf_msg_or_event",
            OpenKfId: "wk-callback",
        });

        expect(client.getKnownOpenKfIds()).toEqual(["wk-event", "wk-callback"]);
    });

    it("保留平台错误并防止原生消息覆盖目标", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(json({ errcode: 95000, errmsg: "service state invalid" }));
        const client = new WeComKfClient(config, fetcher);
        await expect(
            client.sendMessage("customer", "wk-real", {
                msgtype: "text",
                touser: "forged",
                open_kfid: "forged",
                text: { content: "hi" },
            }),
        ).rejects.toMatchObject({
            code: "WECOM_KF_95000",
            path: "/cgi-bin/kf/send_msg",
        });
        const body = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)) as Record<
            string,
            unknown
        >;
        expect(body).toMatchObject({ touser: "customer", open_kfid: "wk-real" });
        expect(body.msgid).toMatch(/^[\da-f]{32}$/u);
    });

    it("在发起请求前拒绝空素材", async () => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WeComKfClient(config, fetcher);

        await expect(
            client.uploadTemporaryMedia("file", new Blob([]), "empty.bin"),
        ).rejects.toMatchObject({
            code: "WECOM_KF_INVALID_UPLOAD",
        });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("按官方数字时间戳解码临时素材响应", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(
                json({ errcode: 0, errmsg: "ok", access_token: "access", expires_in: 7200 }),
            )
            .mockResolvedValueOnce(
                json({
                    errcode: 0,
                    errmsg: "ok",
                    type: "file",
                    media_id: "media-1",
                    created_at: 1788105600,
                }),
            );
        const client = new WeComKfClient(config, fetcher);

        await expect(
            client.uploadTemporaryMedia("file", new Blob(["payload"]), "file.txt"),
        ).resolves.toMatchObject({
            type: "file",
            media_id: "media-1",
            created_at: 1788105600,
        });
    });

    it("拒绝不符合官方长度与字符约束的 msgid", async () => {
        const fetcher = vi.fn<typeof fetch>();
        const client = new WeComKfClient(config, fetcher);

        await expect(
            client.sendMessage("customer", "wk-1", {
                msgtype: "text",
                msgid: "invalid message id because it is far too long",
                text: { content: "hello" },
            }),
        ).rejects.toMatchObject({ code: "WECOM_KF_INVALID_PARAMETER" });
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("通过官方 account/list 完整分页并查找客服账号", async () => {
        const client = new WeComKfClient(config);
        const first = Array.from({ length: 100 }, (_, index) => ({
            open_kfid: `wk-${index}`,
        }));
        const call = vi
            .spyOn(client, "call")
            .mockResolvedValueOnce({ account_list: first })
            .mockResolvedValueOnce({ account_list: [{ open_kfid: "wk-target", name: "Target" }] });
        await expect(client.getAccount("wk-target")).resolves.toMatchObject({ name: "Target" });
        expect(call).toHaveBeenNthCalledWith(1, {
            method: "POST",
            path: "/cgi-bin/kf/account/list",
            body: { offset: 0, limit: 100 },
        });
        expect(call).toHaveBeenNthCalledWith(2, {
            method: "POST",
            path: "/cgi-bin/kf/account/list",
            body: { offset: 100, limit: 100 },
        });
    });
});
