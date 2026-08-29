import type { KookSignal } from "./types.js";

export interface KookSequenceResult {
    duplicate: boolean;
    ready: KookSignal[];
}

/**
 * 按 KOOK sn 保序并去重。
 *
 * 新 session 的首个 sn 可由服务端从任意值开始；首包建立锚点，之后只连续交付。
 * resume 则保留已确认 sn，使离线补发事件继续沿用同一序列。
 */
export class KookGatewaySequence {
    private readonly buffer = new Map<number, KookSignal>();
    private acknowledged?: number;

    get sn(): number {
        return this.acknowledged ?? 0;
    }

    reset(): void {
        this.acknowledged = undefined;
        this.buffer.clear();
    }

    ingest(signal: KookSignal): KookSequenceResult {
        if (signal.s !== 0 || typeof signal.sn !== "number") {
            return { duplicate: false, ready: [signal] };
        }
        const sn = signal.sn;
        if (this.acknowledged === undefined) {
            this.acknowledged = sn;
            return { duplicate: false, ready: [signal] };
        }
        if (sn <= this.acknowledged || this.buffer.has(sn)) {
            return { duplicate: true, ready: [] };
        }
        if (sn > this.acknowledged + 1) {
            this.buffer.set(sn, signal);
            return { duplicate: false, ready: [] };
        }
        const ready = [signal];
        let acknowledged = sn;
        this.acknowledged = acknowledged;
        while (this.buffer.has(acknowledged + 1)) {
            const nextSn: number = acknowledged + 1;
            ready.push(this.buffer.get(nextSn)!);
            this.buffer.delete(nextSn);
            acknowledged = nextSn;
            this.acknowledged = acknowledged;
        }
        return { duplicate: false, ready };
    }
}
