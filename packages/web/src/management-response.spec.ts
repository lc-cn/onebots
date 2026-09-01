import { describe, expect, it, vi } from "vitest";
import {
    readManagementJsonResponse,
    readManagementResponseBody,
    WEB_MANAGEMENT_BODY_LIMIT_BYTES,
} from "./management-response.js";

describe("Web management response boundary", () => {
    it("accepts bounded text and JSON responses", async () => {
        await expect(readManagementResponseBody(new Response("config: true"))).resolves.toBe(
            "config: true",
        );
        await expect(readManagementJsonResponse(Response.json({ success: true }))).resolves.toEqual(
            { success: true },
        );
    });

    it("cancels a response whose declared length exceeds 4 MiB", async () => {
        const cancelled = vi.fn();
        const body = new ReadableStream<Uint8Array>({ cancel: cancelled });
        const response = new Response(body, {
            headers: { "content-length": String(WEB_MANAGEMENT_BODY_LIMIT_BYTES + 1) },
        });

        await expect(readManagementJsonResponse(response)).rejects.toThrow(
            "响应正文超过 4 MiB 上限",
        );
        expect(cancelled).toHaveBeenCalledOnce();
    });
});
