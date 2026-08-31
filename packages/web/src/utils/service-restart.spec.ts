import { describe, expect, it, vi } from "vitest";
import { readCurrentServiceInstanceId, waitForServiceRestart } from "./service-restart";

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
});
