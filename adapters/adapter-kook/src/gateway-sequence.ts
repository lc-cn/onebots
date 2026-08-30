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
    private pending?: KookSignal;

    get sn(): number {
        return this.acknowledged ?? 0;
    }

    reset(): void {
        this.acknowledged = undefined;
        this.pending = undefined;
        this.buffer.clear();
    }

    /** 暂存信令并返回当前可投递项；此阶段不会推进已确认 sn。 */
    ingest(signal: KookSignal): KookSequenceResult {
        if (signal.s !== 0 || typeof signal.sn !== "number") {
            return { duplicate: false, ready: [signal] };
        }
        const sn = signal.sn;
        if (this.acknowledged === undefined) {
            if (this.pending) {
                if (sn === this.pending.sn) return { duplicate: false, ready: [this.pending] };
                if (sn < (this.pending.sn ?? sn)) return { duplicate: true, ready: [] };
                if (this.buffer.has(sn)) return { duplicate: true, ready: [] };
                this.buffer.set(sn, signal);
                return { duplicate: false, ready: [] };
            }
            this.pending = signal;
            return { duplicate: false, ready: [signal] };
        }
        if (sn <= this.acknowledged || this.buffer.has(sn)) {
            return { duplicate: true, ready: [] };
        }
        if (this.pending?.sn === sn) return { duplicate: false, ready: [this.pending] };
        if (sn > this.acknowledged + 1) {
            this.buffer.set(sn, signal);
            return { duplicate: false, ready: [] };
        }
        this.pending = signal;
        return { duplicate: false, ready: [signal] };
    }

    /** 仅在当前信令的业务投递成功后提交，并释放下一条连续信令。 */
    commit(signal: KookSignal): KookSignal | undefined {
        if (signal.s !== 0 || typeof signal.sn !== "number") return undefined;
        if (!this.pending || this.pending.sn !== signal.sn) {
            throw new Error("KOOK Gateway 只能提交当前待确认信令");
        }
        this.acknowledged = signal.sn;
        this.pending = undefined;
        const nextSn = signal.sn + 1;
        const next = this.buffer.get(nextSn);
        if (next) {
            this.buffer.delete(nextSn);
            this.pending = next;
        }
        return next;
    }
}
