import { describe, expect, it } from "vitest";
import { decodeHeychatEnvelope, HeychatEventIngress } from "./ingress.js";

function envelope(sequence: number) {
    return { sequence, type: "50", timestamp: 1_700_000_000, data: {} };
}

describe("HeychatEventIngress", () => {
    it("统一接收结构化事件与 WebSocket 帧并按连接代次成功确认", async () => {
        const ingress = new HeychatEventIngress();
        const consume = async () => undefined;
        expect((await ingress.ingest(envelope(9), consume)).duplicate).toBe(false);
        expect(
            (await ingress.ingest(Buffer.from(JSON.stringify(envelope(9))), consume)).duplicate,
        ).toBe(true);
        ingress.reset();
        expect((await ingress.ingest(envelope(1), consume)).duplicate).toBe(false);
    });

    it("消费失败不确认，同序号可重投且不同序号不会被范围误判", async () => {
        const ingress = new HeychatEventIngress();
        let attempts = 0;
        const consume = async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("temporary failure");
        };

        await expect(ingress.ingest(envelope(8), consume)).rejects.toThrow("temporary failure");
        expect((await ingress.ingest(envelope(9), consume)).duplicate).toBe(false);
        expect((await ingress.ingest(envelope(8), consume)).duplicate).toBe(false);
        expect((await ingress.ingest(envelope(8), consume)).duplicate).toBe(true);
    });

    it("拒绝非法 JSON、非有限数字与超大载荷", () => {
        expect(() => decodeHeychatEnvelope("{")).toThrowError(
            expect.objectContaining({ code: "HEYCHAT_INVALID_WS_EVENT" }),
        );
        expect(() => decodeHeychatEnvelope({ ...envelope(1), timestamp: Number.NaN })).toThrowError(
            expect.objectContaining({ code: "HEYCHAT_INVALID_WS_EVENT" }),
        );
        expect(() => decodeHeychatEnvelope(Buffer.alloc(1024 * 1024 + 1))).toThrowError(
            expect.objectContaining({ code: "HEYCHAT_EVENT_TOO_LARGE" }),
        );
    });
});
