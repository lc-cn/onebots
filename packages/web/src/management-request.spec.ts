import { describe, expect, it } from "vitest";
import { managementRequestInit } from "./management-request.js";

describe("management request cache policy", () => {
    it("defaults every management request to no-store without dropping request options", () => {
        const signal = AbortSignal.timeout(1_000);
        const headers = { "Content-Type": "application/json" };

        expect(managementRequestInit({ method: "POST", headers, signal })).toEqual({
            method: "POST",
            headers,
            signal,
            cache: "no-store",
        });
    });

    it("preserves an explicit caller cache mode", () => {
        expect(managementRequestInit({ cache: "reload" })).toEqual({ cache: "reload" });
    });
});
