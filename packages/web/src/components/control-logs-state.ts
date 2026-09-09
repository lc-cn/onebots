import {
    sanitizeLogText,
    type ControlClient,
    type ControlLogSnapshot,
} from "@onebots/core/control";

export interface LogView {
    snapshot: ControlLogSnapshot | undefined;
    busy: boolean;
    error: string;
}
export function logView(): LogView {
    return { snapshot: undefined, busy: false, error: "" };
}
/** 只有显式 refresh 才读取；更换设备或卸载立即抹除本次日志。 */
export class LogController {
    private revision = 0;
    private disposed = false;
    constructor(
        private client: { logs: Pick<ControlClient["logs"], "gateway"> },
        private view: LogView,
    ) {}
    setClient(client: { logs: Pick<ControlClient["logs"], "gateway"> }): void {
        this.revision++;
        this.client = client;
        this.view.snapshot = undefined;
        this.view.error = "";
        this.view.busy = false;
    }
    async refresh(): Promise<void> {
        if (this.disposed || this.view.busy) return;
        const revision = ++this.revision;
        this.view.snapshot = undefined;
        this.view.error = "";
        this.view.busy = true;
        try {
            const snapshot = await this.client.logs.gateway();
            if (this.disposed || revision !== this.revision) return;
            this.view.snapshot = { ...snapshot, text: sanitizeLogText(snapshot.text) };
        } catch {
            if (this.disposed || revision !== this.revision) return;
            this.view.error = "无法读取网关日志，请检查管理会话和服务状态。";
        } finally {
            if (!this.disposed && revision === this.revision) this.view.busy = false;
        }
    }
    dispose(): void {
        this.disposed = true;
        this.revision++;
        this.view.snapshot = undefined;
        this.view.error = "";
        this.view.busy = false;
    }
}
