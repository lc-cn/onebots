import { describe, expect, it } from "vitest";
import { decodeHeychatEnvelope, HeychatEventIngress } from "./ingress.js";

function envelope(sequence: number) {
    return { sequence, type: "50", timestamp: 1_700_000_000, data: {} };
}

describe("HeychatEventIngress", () => {
    it("统一接收结构化事件与 WebSocket 帧并按连接代次去重", () => {
        const ingress = new HeychatEventIngress();
        expect(ingress.ingest(envelope(9)).duplicate).toBe(false);
        expect(ingress.ingest(Buffer.from(JSON.stringify(envelope(9)))).duplicate).toBe(true);
        ingress.reset();
        expect(ingress.ingest(envelope(1)).duplicate).toBe(false);
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
