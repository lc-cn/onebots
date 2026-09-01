import type { Context } from "koa";
import { afterEach, describe, expect, it } from "vitest";
import { metrics, MetricsCollector } from "../metrics.js";
import { metricsCollector } from "./metrics-collector.js";

function requestContext(path: string): Context {
    return {
        method: "GET",
        path,
        status: 200,
    } as Context;
}

describe("metrics collector ownership", () => {
    afterEach(() => metrics.reset());

    it("只写入显式注入的收集器", async () => {
        const first = new MetricsCollector();
        const second = new MetricsCollector();

        await metricsCollector(first)(requestContext("/first"), async () => undefined);
        await metricsCollector(second)(requestContext("/second"), async () => undefined);
        await metricsCollector(second)(requestContext("/second"), async () => undefined);

        expect(first.getLatestValue("http_requests_total", { method: "GET", path: "/first" })).toBe(
            1,
        );
        expect(
            first.getLatestValue("http_requests_total", { method: "GET", path: "/second" }),
        ).toBeUndefined();
        expect(
            second.getLatestValue("http_requests_total", { method: "GET", path: "/second" }),
        ).toBe(2);
    });

    it("无参数调用继续写入兼容的全局收集器", async () => {
        await metricsCollector()(requestContext("/legacy"), async () => undefined);

        expect(
            metrics.getLatestValue("http_requests_total", { method: "GET", path: "/legacy" }),
        ).toBe(1);
    });
});
