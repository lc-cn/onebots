import { describe, expect, it, vi } from "vitest";
import { acceptSlackSocketEnvelope } from "./socket-envelope.js";

describe("Slack Socket Mode envelope", () => {
    it("canonical 投递成功后才 ack，并保留 envelope_id", async () => {
        const order: string[] = [];
        const ingest = vi.fn(() => order.push("ingest"));
        const ack = vi.fn(async () => {
            order.push("ack");
        });

        await expect(
            acceptSlackSocketEnvelope(
                {
                    envelope_id: "E1",
                    body: { type: "event_callback", event: { type: "message" } },
                    ack,
                },
                ingest,
            ),
        ).resolves.toBe(true);

        expect(ingest).toHaveBeenCalledWith(
            expect.objectContaining({ envelope_id: "E1", type: "event_callback" }),
        );
        expect(order).toEqual(["ingest", "ack"]);
    });

    it("投递失败时不 ack，使 Slack 可以重投", async () => {
        const ack = vi.fn(async () => undefined);
        const error = new Error("projection failed");

        await expect(
            acceptSlackSocketEnvelope({ envelope_id: "E1", ack }, () => {
                throw error;
            }),
        ).rejects.toBe(error);
        expect(ack).not.toHaveBeenCalled();
    });

    it("忽略非 Socket Mode envelope", async () => {
        await expect(acceptSlackSocketEnvelope({}, vi.fn())).resolves.toBe(false);
    });
});
