import type { ControlClient, ControlMessageDebugEntry } from "@onebots/core/control";

export interface MessageDebugView {
    entries: ControlMessageDebugEntry[];
    instanceId: string | undefined;
    available: boolean;
    loading: boolean;
    clearing: boolean;
    automatic: boolean;
    error: string;
}
export const messageDebugView = (): MessageDebugView => ({
    entries: [],
    instanceId: undefined,
    available: false,
    loading: false,
    clearing: false,
    automatic: false,
    error: "",
});

/** 生命周期和授权由组件实例隔离；任何过期请求均不能写入新的视图。 */
export class MessageDebugController {
    private revision = 0;
    private disposed = false;
    private active = true;
    private inFlight = false;
    private clearedThrough = 0;
    private timer: ReturnType<typeof setTimeout> | undefined;
    constructor(
        private readonly client: Pick<ControlClient, "messageDebugHistory" | "clearMessageDebug">,
        readonly view: MessageDebugView,
    ) {}

    setGateway(instanceId: string | undefined): void {
        if (this.disposed || this.view.instanceId === instanceId) return;
        this.revision++;
        this.view.instanceId = instanceId;
        this.view.entries = [];
        this.view.available = false;
        this.view.error = "";
        this.clearedThrough = 0;
    }
    setActive(active: boolean): void {
        if (this.disposed || this.active === active) return;
        this.active = active;
        this.cancelTimer();
        if (!active) {
            this.revision++;
            this.view.loading = false;
            this.view.clearing = false;
            return;
        }
        if (this.view.automatic) void this.refresh();
    }
    setAutomatic(enabled: boolean): void {
        if (this.disposed) return;
        this.view.automatic = enabled;
        this.cancelTimer();
        if (enabled && !this.inFlight) void this.refresh();
    }
    private cancelTimer(): void {
        if (this.timer !== undefined) clearTimeout(this.timer);
        this.timer = undefined;
    }
    private schedule(): void {
        if (!this.disposed && this.active && this.view.automatic) {
            this.cancelTimer();
            this.timer = setTimeout(() => void this.refresh(), 1000);
        }
    }
    async refresh(): Promise<void> {
        if (this.disposed || !this.active || this.inFlight) return;
        this.cancelTimer();
        const instanceId = this.view.instanceId;
        if (!instanceId) {
            this.schedule();
            return;
        }
        const revision = this.revision;
        this.inFlight = true;
        this.view.loading = true;
        try {
            const snapshot = await this.client.messageDebugHistory();
            if (this.disposed || revision !== this.revision) return;
            if (snapshot.gatewayInstanceId !== instanceId)
                throw new Error("网关实例已变化，请刷新网关状态后重新读取消息。");
            this.view.entries = snapshot.entries.filter(entry => entry.seq > this.clearedThrough);
            this.view.available = true;
            this.view.error = "";
        } catch (error) {
            if (this.disposed || revision !== this.revision) return;
            this.view.entries = [];
            this.view.available = false;
            this.view.error = error instanceof Error ? error.message : "消息历史暂不可用";
        } finally {
            this.inFlight = false;
            if (!this.disposed) this.view.loading = false;
            this.schedule();
        }
    }
    async clear(): Promise<void> {
        const instanceId = this.view.instanceId;
        if (this.disposed || !this.active || this.inFlight || !instanceId || !this.view.available)
            return;
        this.cancelTimer();
        const revision = this.revision;
        this.inFlight = true;
        this.view.clearing = true;
        try {
            const receipt = await this.client.clearMessageDebug(instanceId);
            if (this.disposed || revision !== this.revision) return;
            this.clearedThrough = Math.max(this.clearedThrough, receipt.clearedThroughSeq);
            this.view.entries = this.view.entries.filter(entry => entry.seq > this.clearedThrough);
            this.view.error = "";
        } catch {
            if (this.disposed || revision !== this.revision) return;
            this.view.automatic = false;
            this.view.available = false;
            this.view.error =
                "清空结果未确认；当前显示的是操作前记录。请手动刷新核验，不要重复清空。";
        } finally {
            this.inFlight = false;
            if (!this.disposed) this.view.clearing = false;
            this.schedule();
        }
    }
    dispose(): void {
        this.disposed = true;
        this.revision++;
        this.cancelTimer();
        this.view.automatic = false;
        this.view.entries = [];
        this.view.available = false;
    }
}
