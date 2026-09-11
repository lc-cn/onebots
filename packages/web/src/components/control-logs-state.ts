import {
    sanitizeLogText,
    type ControlClient,
    type ControlLogBatch,
    type ControlLogSource,
} from "@onebots/core/control";

export type LogConnectionState = "paused" | "connecting" | "live" | "error";

export interface LogSourceView {
    snapshot: ControlLogBatch | undefined;
    status: LogConnectionState;
    error: string;
}

export interface LogView {
    source: ControlLogSource;
    sources: Record<ControlLogSource, LogSourceView>;
}

const emptySource = (): LogSourceView => ({ snapshot: undefined, status: "paused", error: "" });

export function logView(): LogView {
    return {
        source: "gateway",
        sources: { manager: emptySource(), gateway: emptySource(), operation: emptySource() },
    };
}

const MAX_VISIBLE_CHARACTERS = 262_144;

function mergeBatch(
    previous: ControlLogBatch | undefined,
    batch: ControlLogBatch,
): ControlLogBatch {
    const text = sanitizeLogText(batch.reset ? batch.text : `${previous?.text ?? ""}${batch.text}`);
    return {
        ...batch,
        text: text.slice(-MAX_VISIBLE_CHARACTERS),
        truncated: batch.truncated || text.length > MAX_VISIBLE_CHARACTERS,
    };
}

type LogClient = { logs: Pick<ControlClient["logs"], "stream"> };

/** 页面和 Tab 共同拥有流生命周期；任一边界变化都会先中止旧连接。 */
export class LogController {
    private revision = 0;
    private active = false;
    private disposed = false;
    private abortController: AbortController | undefined;

    constructor(
        private client: LogClient,
        private view: LogView,
    ) {}

    setActive(active: boolean): void {
        if (this.disposed || this.active === active) return;
        this.active = active;
        this.disconnect();
        if (active) void this.connect();
    }

    setClient(client: LogClient): void {
        if (this.disposed) return;
        this.disconnect();
        this.client = client;
        this.view.sources = {
            manager: emptySource(),
            gateway: emptySource(),
            operation: emptySource(),
        };
        if (this.active) void this.connect();
    }

    setSource(source: ControlLogSource): void {
        if (this.disposed || this.view.source === source) return;
        this.disconnect();
        this.view.source = source;
        if (this.active) void this.connect();
    }

    retry(): void {
        if (!this.disposed && this.active) {
            this.disconnect();
            void this.connect();
        }
    }

    private disconnect(): void {
        this.revision++;
        this.abortController?.abort();
        this.abortController = undefined;
        for (const source of Object.values(this.view.sources)) {
            if (source.status !== "error") source.status = "paused";
        }
    }

    private async connect(): Promise<void> {
        if (this.disposed || !this.active || this.abortController) return;
        const revision = this.revision;
        const source = this.view.source;
        const sourceView = this.view.sources[source];
        const controller = new AbortController();
        this.abortController = controller;
        sourceView.status = "connecting";
        sourceView.error = "";
        try {
            const cursor = sourceView.snapshot?.cursor;
            for await (const batch of this.client.logs.stream(
                { source, ...(cursor ? { cursor } : {}) },
                { signal: controller.signal },
            )) {
                if (this.disposed || revision !== this.revision || controller.signal.aborted)
                    return;
                sourceView.snapshot = mergeBatch(sourceView.snapshot, batch);
                sourceView.status = "live";
                sourceView.error = "";
            }
            if (!controller.signal.aborted && revision === this.revision)
                throw new Error("stream closed");
        } catch {
            if (this.disposed || revision !== this.revision || controller.signal.aborted) return;
            sourceView.status = "error";
            sourceView.error = "实时日志连接已断开，请检查管理会话和服务状态。";
        } finally {
            if (this.abortController === controller) this.abortController = undefined;
        }
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.active = false;
        this.disconnect();
        this.view.sources = {
            manager: emptySource(),
            gateway: emptySource(),
            operation: emptySource(),
        };
    }
}
