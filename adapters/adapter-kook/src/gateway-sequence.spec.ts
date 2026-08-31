import { describe, expect, test } from "vitest";
import { KookGatewaySequence } from "./gateway-sequence.js";
import type { KookSignal } from "./types.js";

describe("KOOK Gateway 序列", () => {
    test("缓冲乱序事件并按 sn 连续交付", () => {
        const sequence = new KookGatewaySequence();
        expect(sequence.ingest(signal(10)).ready.map(item => item.sn)).toEqual([10]);
        expect(sequence.sn).toBe(0);
        sequence.commit(signal(10));
        expect(sequence.ingest(signal(12)).ready).toEqual([]);
        expect(sequence.sn).toBe(10);
        expect(sequence.ingest(signal(11)).ready.map(item => item.sn)).toEqual([11]);
        expect(sequence.commit(signal(11))?.sn).toBe(12);
        sequence.commit(signal(12));
        expect(sequence.sn).toBe(12);
    });

    test("丢弃已处理和已缓冲的重复事件", () => {
        const sequence = new KookGatewaySequence();
        sequence.ingest(signal(4));
        expect(sequence.ingest(signal(4)).duplicate).toBe(false);
        sequence.commit(signal(4));
        expect(sequence.ingest(signal(4)).duplicate).toBe(true);
        sequence.ingest(signal(6));
        expect(sequence.ingest(signal(6)).duplicate).toBe(true);
    });

    test("重置后允许新 session 重新建立序列锚点", () => {
        const sequence = new KookGatewaySequence();
        sequence.ingest(signal(100));
        sequence.reset();
        expect(sequence.ingest(signal(1)).ready.map(item => item.sn)).toEqual([1]);
        expect(sequence.sn).toBe(0);
    });

    test("投递失败前不确认，重投同一 sn 后才释放缓冲事件", () => {
        const sequence = new KookGatewaySequence();
        expect(sequence.ingest(signal(7)).ready.map(item => item.sn)).toEqual([7]);
        expect(sequence.ingest(signal(9)).ready).toEqual([]);
        expect(sequence.ingest(signal(7)).ready.map(item => item.sn)).toEqual([7]);
        sequence.commit(signal(7));
        expect(sequence.ingest(signal(8)).ready.map(item => item.sn)).toEqual([8]);
        expect(sequence.commit(signal(8))?.sn).toBe(9);
    });
});

function signal(sn: number): KookSignal {
    return { s: 0, sn };
}
