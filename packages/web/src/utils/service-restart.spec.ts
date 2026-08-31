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
});
