import { describe, expect, it, vi } from "vitest";
import {
    readCurrentServiceInstanceId,
    requestServiceRestart,
    waitForServiceRestart,
} from "./service-restart";

function health(instanceId?: string, application = "onebots") {
    return new Response(JSON.stringify({ status: "ok", application, instance_id: instanceId }), {
        status: 200,
    });
}

describe("Web service restart verification", () => {
    it("reads the current process identity before requesting restart", async () => {
        await expect(readCurrentServiceInstanceId(vi.fn(async () => health("old")))).resolves.toBe(
            "old",
        );
    });

    it.each([
        [
            "不可达",
            vi.fn(async () => Promise.reject(new Error("connection refused"))),
            /health 不可达/,
        ],
        ["错误应用", vi.fn(async () => health("old", "not-onebots")), /未声明 onebots 应用身份/],
        ["缺少身份", vi.fn(async () => health()), /未声明 instance_id/],
    ])("refuses restart when the current endpoint is %s", async (_name, fetcher, evidence) => {
        await expect(readCurrentServiceInstanceId(fetcher)).rejects.toThrow(evidence);
        await expect(readCurrentServiceInstanceId(fetcher)).rejects.toThrow(/未发送重启请求/);
    });

    it("waits until a different OneBots instance owns the health endpoint", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(health("old"))
            .mockResolvedValueOnce(health("new"));
        const sleep = vi.fn(async () => undefined);

        await expect(
            waitForServiceRestart("old", {
                fetcher,
                attempts: 2,
                initialDelayMs: 0,
                intervalMs: 1,
                sleep,
            }),
        ).resolves.toBe("new");
        expect(sleep).toHaveBeenCalledOnce();
    });

    it("rejects HTTP success from the old or an unidentified process", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(health("old"))
            .mockResolvedValueOnce(health("other", "not-onebots"));

        await expect(
            waitForServiceRestart("old", {
                fetcher,
                attempts: 2,
                initialDelayMs: 0,
                intervalMs: 0,
            }),
        ).rejects.toThrow(/未观察到新实例.*health 未声明 onebots 应用身份/);
    });

    it("refuses to wait without a trusted previous process identity", async () => {
        const fetcher = vi.fn<typeof fetch>();

        await expect(
            waitForServiceRestart("", {
                fetcher,
                initialDelayMs: 0,
            }),
        ).rejects.toThrow(/缺少重启前的实例身份/);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it("bounds a stalled pre-restart identity probe", async () => {
        const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));

        await expect(readCurrentServiceInstanceId(fetcher, 5)).rejects.toThrow(
            /health 探测超时（5ms）.*未发送重启请求/,
        );
        expect(fetcher.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
        expect(fetcher.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    });

    it("refuses restart when the preflight health body exceeds its byte boundary", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response("{}", {
                    headers: { "content-length": String(64 * 1024 + 1) },
                }),
        );

        await expect(readCurrentServiceInstanceId(fetcher)).rejects.toThrow(
            "响应正文超过 64 KiB 上限",
        );
        expect(fetcher).toHaveBeenCalledOnce();
    });

    it("keeps every restart probe bounded when the endpoint stalls", async () => {
        const fetcher = vi.fn<typeof fetch>(() => new Promise(() => undefined));

        await expect(
            waitForServiceRestart("old", {
                fetcher,
                attempts: 2,
                initialDelayMs: 0,
                intervalMs: 0,
                probeTimeoutMs: 5,
            }),
        ).rejects.toThrow(/未观察到新实例.*health 探测超时（5ms）/);
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("sends the expected instance and accepts only its semantic restart acknowledgement", async () => {
        const fetcher = vi.fn<typeof fetch>(async () =>
            Response.json({
                success: true,
                application: "onebots",
                instance_id: "old",
                scheduled: true,
                message: "服务即将重启",
            }),
        );

        await expect(requestServiceRestart("old", fetcher)).resolves.toEqual({
            scheduled: true,
            message: "服务即将重启",
        });
        expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({
            instance_id: "old",
        });
    });

    it("does not send a restart request without a trusted current identity", async () => {
        const fetcher = vi.fn<typeof fetch>();

        await expect(requestServiceRestart(" ", fetcher)).rejects.toThrow(/缺少可信的当前实例身份/);
        expect(fetcher).not.toHaveBeenCalled();
    });

    it.each([
        ["空的成功响应", new Response("", { status: 200 }), /未返回有效 JSON 回执/],
        [
            "错误应用",
            Response.json({
                success: true,
                application: "other",
                instance_id: "old",
                scheduled: true,
            }),
            /未声明 onebots 应用身份/,
        ],
        [
            "另一实例",
            Response.json({
                success: true,
                application: "onebots",
                instance_id: "new",
                scheduled: true,
            }),
            /实例不匹配.*实际 new/,
        ],
        [
            "缺少调度状态",
            Response.json({
                success: true,
                application: "onebots",
                instance_id: "old",
            }),
            /未声明调度状态/,
        ],
    ])(
        "rejects %s instead of waiting for a coincidental restart",
        async (_name, response, error) => {
            await expect(
                requestServiceRestart(
                    "old",
                    vi.fn(async () => response.clone()),
                ),
            ).rejects.toThrow(error);
        },
    );
});
