import { isControlVerificationCommand, controlVerificationOutcome } from "@onebots/core/control";
import { createControlOperationId } from "../control-operation-id.js";
import type {
    ControlClient,
    ControlVerificationAbandonment,
    ControlVerificationOperation,
    ControlVerificationSnapshot,
} from "@onebots/core/control";

export interface VerificationView {
    snapshot?: ControlVerificationSnapshot;
    answers: Record<string, Record<string, string>>;
    ids: string[];
    receipts: Record<string, ControlVerificationOperation>;
    abandonments: Record<string, ControlVerificationAbandonment>;
    queryFailures: Record<string, boolean>;
    busy: boolean;
    ready: boolean;
    error: string;
}
export const verificationView = (): VerificationView => ({
    answers: {},
    ids: [],
    receipts: {},
    abandonments: {},
    queryFailures: {},
    busy: false,
    ready: false,
    error: "",
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function safeVerificationUrl(
    value: string,
    origin = typeof window === "undefined" ? undefined : window.location.origin,
): string | undefined {
    try {
        if (
            value.trim() !== value ||
            value.startsWith("//") ||
            value.includes("\\") ||
            /[\u0000-\u001f\u007f]/u.test(value)
        )
            return undefined;
        const relative = value.startsWith("/");
        if (relative && !origin) return undefined;
        const url = new URL(value, origin);
        if (relative && url.origin !== origin) return undefined;
        if (["http:", "https:"].includes(url.protocol) && !url.username && !url.password)
            return url.href;
    } catch {
        /* 非 URL 验证文本不作为链接。 */
    }
    return undefined;
}
export function safeVerificationImage(value: string): string | undefined {
    if (value.length <= 1024 * 1024 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)) {
        const mime = value.startsWith("iVBORw0KGgo")
            ? "png"
            : value.startsWith("/9j/")
              ? "jpeg"
              : value.startsWith("R0lGOD")
                ? "gif"
                : undefined;
        if (mime) return `data:image/${mime};base64,${value}`;
    }
    return value.length <= 1024 * 1024 &&
        /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(value)
        ? value
        : undefined;
}
export class VerificationController {
    private revision = 0;
    private closed = false;
    private gateway?: string;
    private key?: string;
    constructor(
        private readonly client: {
            verification: Pick<
                ControlClient["verification"],
                | "pending"
                | "execute"
                | "operation"
                | "reconcile"
                | "acknowledge"
                | "abandon"
                | "abandonment"
            >;
            sessions: ControlClient["sessions"];
        },
        readonly view: VerificationView,
        private readonly storage: Pick<Storage, "getItem" | "setItem">,
    ) {}
    async initialize(): Promise<void> {
        if (this.closed || this.view.busy || this.view.ready) return;
        if (!globalThis.crypto?.getRandomValues) {
            this.view.error = "浏览器不支持安全随机数，已禁止提交。请升级浏览器或使用 CLI/TUI。";
            return;
        }
        this.view.busy = true;
        try {
            const result = await this.client.sessions();
            if (this.closed) return;
            const current = result.sessions.filter(session => session.current);
            if (current.length !== 1 || !/^[a-f0-9]{32}$/.test(current[0].id))
                throw new Error("session");
            this.key = `onebots.verification.${current[0].id}`;
            const raw = this.storage.getItem(this.key);
            const ids: unknown = raw === null ? [] : JSON.parse(raw);
            if (
                !Array.isArray(ids) ||
                ids.length > 128 ||
                ids.some(id => typeof id !== "string" || !uuid.test(id)) ||
                new Set(ids).size !== ids.length
            )
                throw new Error("invalid");
            this.view.ids = ids;
            this.view.ready = true;
            await this.resolveUnconfirmed(this.revision);
        } catch {
            if (!this.closed)
                this.view.error =
                    "无法读取当前设备或安全操作记录，已禁止提交。请保留浏览器数据，通过本地入口排查。";
        } finally {
            this.view.busy = false;
        }
    }
    setGateway(id?: string): void {
        if (this.gateway === id) return;
        this.gateway = id;
        this.revision++;
        this.view.snapshot = undefined;
        this.view.answers = {};
    }
    get uncertain(): boolean {
        return this.view.ids.some(id =>
            this.view.receipts[id]
                ? ["running", "unknown"].includes(
                      controlVerificationOutcome(this.view.receipts[id]),
                  )
                : !this.view.abandonments[id],
        );
    }
    async refresh(): Promise<void> {
        if (this.closed || this.view.busy || !this.gateway) return;
        const revision = this.revision;
        this.view.busy = true;
        this.view.answers = {};
        this.view.snapshot = undefined;
        try {
            // 旧操作只读查询后再呈现新挑战，避免让用户手动点击历史回执才能继续。
            await this.resolveUnconfirmed(revision);
            if (this.closed || revision !== this.revision) return;
            const snapshot = await this.client.verification.pending();
            if (this.closed || revision !== this.revision) return;
            if (snapshot.gatewayInstanceId !== this.gateway) throw new Error("changed");
            this.view.snapshot = snapshot;
            this.view.answers = Object.fromEntries(snapshot.challenges.map(item => [item.id, {}]));
            this.view.error = "";
        } catch {
            if (!this.closed && revision === this.revision)
                this.view.error = "无法读取验证请求，请检查网关状态后刷新。";
        } finally {
            this.view.busy = false;
        }
    }
    async submit(
        challengeId: string,
        action: "submit" | "request-sms",
        shortcut?: string,
    ): Promise<void> {
        const snapshot = this.view.snapshot;
        const challenge = snapshot?.challenges.find(item => item.id === challengeId);
        if (
            this.closed ||
            this.view.busy ||
            !this.view.ready ||
            !this.key ||
            this.uncertain ||
            !snapshot ||
            !challenge ||
            challenge.expiresAt <= Date.now() ||
            snapshot.gatewayInstanceId !== this.gateway
        )
            return;
        const inputs =
            challenge.request.options?.blocks?.filter(block => block.type === "input") ?? [];
        if (
            shortcut
                ? !challenge.request.actions?.some(item => item.id === shortcut)
                : action === "request-sms"
                  ? !challenge.request.requestSmsAvailable
                  : !inputs.length && !challenge.request.confirmable
        )
            return;
        if (
            action === "submit" &&
            !shortcut &&
            inputs.some(input => {
                const value = this.view.answers[challengeId]?.[input.key] ?? "";
                return (
                    !value.trim() ||
                    value.length > (input.maxLength ?? 16384) ||
                    new TextEncoder().encode(value).length > 16384 ||
                    /[\u0000-\u001f\u007f]/u.test(value)
                );
            })
        ) {
            this.view.error = "请填写所有验证字段，并检查输入长度。";
            return;
        }
        const revision = this.revision;
        this.view.busy = true;
        let id: string | undefined;
        try {
            if (this.view.ids.length >= 128) throw new Error("capacity");
            const data = shortcut
                ? { action: shortcut }
                : action === "submit"
                  ? { ...this.view.answers[challengeId] }
                  : undefined;
            const command = {
                operationId: createControlOperationId(),
                challengeId,
                expected: {
                    gatewayInstanceId: snapshot.gatewayInstanceId,
                    configVersion: snapshot.configVersion,
                },
                action,
                ...(data ? { data } : {}),
            };
            if (!isControlVerificationCommand(command)) {
                this.view.error = "验证输入格式或总长度不符合要求，未发送请求。";
                return;
            }
            id = command.operationId;
            const ids = [...this.view.ids, id];
            this.storage.setItem(this.key, JSON.stringify(ids));
            if (this.storage.getItem(this.key) !== JSON.stringify(ids)) throw new Error("storage");
            this.view.ids = ids;
            this.view.answers = {};
            this.view.snapshot = undefined;
            const receipt = await this.client.verification.execute(command);
            if (this.closed || revision !== this.revision) return;
            this.view.receipts[id] = receipt;
            this.view.snapshot = undefined;
            this.view.error = "";
        } catch {
            if (!this.closed && revision === this.revision)
                this.view.error =
                    id && this.view.ids.includes(id)
                        ? "结果未确认。只查询原操作回执，不要换编号重新提交或发短信。"
                        : "无法保存操作编号，未发送验证请求。";
        } finally {
            this.view.snapshot = undefined;
            this.view.answers = {};
            this.view.busy = false;
        }
    }
    async query(id: string): Promise<void> {
        if (this.closed || this.view.busy || !this.view.ids.includes(id)) return;
        this.view.busy = true;
        const revision = this.revision;
        try {
            await this.loadReceipt(id, revision);
            if (this.view.queryFailures[id])
                this.view.error = "回执仍未确认，请保留原操作编号。查询失败不代表操作未执行。";
            else this.view.error = "";
        } finally {
            this.view.busy = false;
        }
    }
    private async resolveUnconfirmed(revision: number): Promise<void> {
        const unresolved = this.view.ids.filter(id => {
            if (this.view.abandonments[id]) return false;
            const receipt = this.view.receipts[id];
            return !receipt || ["running", "unknown"].includes(controlVerificationOutcome(receipt));
        });
        for (let index = 0; index < unresolved.length; index += 4) {
            await Promise.all(
                unresolved.slice(index, index + 4).map(id => this.loadReceipt(id, revision)),
            );
            if (this.closed || revision !== this.revision) return;
        }
    }
    private async loadReceipt(id: string, revision: number): Promise<void> {
        try {
            const receipt = await this.client.verification.operation(id);
            if (!receipt || receipt.id !== id) throw new Error("回执编号不匹配");
            if (!this.closed && revision === this.revision) {
                this.view.receipts[id] = receipt;
                delete this.view.queryFailures[id];
            }
            return;
        } catch {
            if (this.closed || revision !== this.revision) return;
        }
        try {
            const abandonment = await this.client.verification.abandonment(id);
            if (!abandonment || abandonment.id !== id) throw new Error("封存编号不匹配");
            if (!this.closed && revision === this.revision && !this.view.receipts[id]) {
                this.view.abandonments[id] = abandonment;
                delete this.view.queryFailures[id];
            }
        } catch {
            if (!this.closed && revision === this.revision) this.view.queryFailures[id] = true;
        }
    }
    async reconcile(id: string): Promise<void> {
        const operation = this.view.receipts[id];
        if (
            this.closed ||
            this.view.busy ||
            !this.view.ids.includes(id) ||
            operation?.status !== "unknown" ||
            operation.resolution ||
            operation.acknowledgement
        )
            return;
        this.view.busy = true;
        const revision = this.revision;
        try {
            const receipt = await this.client.verification.reconcile(id);
            if (!this.closed && revision === this.revision) {
                this.view.receipts[id] = receipt;
                this.view.error =
                    controlVerificationOutcome(receipt) === "unknown"
                        ? "原网关尚无确定结果，继续保留未知；不要重新提交。"
                        : "";
            }
        } catch {
            if (!this.closed && revision === this.revision)
                this.view.error = "核对结果未确认，请查询原操作回执，不要重新提交。";
        } finally {
            this.view.busy = false;
        }
    }
    async acknowledge(id: string, acceptUnknownOutcome: boolean): Promise<void> {
        const operation = this.view.receipts[id];
        if (
            this.closed ||
            this.view.busy ||
            this.gateway ||
            !acceptUnknownOutcome ||
            !this.view.ids.includes(id) ||
            operation?.status !== "unknown" ||
            operation.resolution ||
            operation.acknowledgement
        )
            return;
        this.view.busy = true;
        const revision = this.revision;
        try {
            const receipt = await this.client.verification.acknowledge(id, true);
            if (!this.closed && revision === this.revision) {
                this.view.receipts[id] = receipt;
                this.view.error = "";
            }
        } catch {
            if (!this.closed && revision === this.revision)
                this.view.error =
                    "接受结果未确认，请查询原操作回执。网关必须已停止；不要重新提交。";
        } finally {
            this.view.busy = false;
        }
    }
    async abandon(id: string, confirm: boolean): Promise<void> {
        if (
            this.closed ||
            this.view.busy ||
            this.gateway ||
            !confirm ||
            !this.view.ids.includes(id) ||
            this.view.receipts[id] ||
            this.view.abandonments[id]
        )
            return;
        this.view.busy = true;
        const revision = this.revision;
        try {
            const receipt = await this.client.verification.abandon(id, true);
            if (!this.closed && revision === this.revision) {
                this.view.abandonments[id] = receipt;
                this.view.error = "";
            }
        } catch {
            if (!this.closed && revision === this.revision)
                this.view.error =
                    "封存未确认，请查询原编号；服务端必须确认原操作未受理且网关已停止。不要清除记录或重新提交。";
        } finally {
            this.view.busy = false;
        }
    }
    dispose(): void {
        this.closed = true;
        this.revision++;
        this.view.answers = {};
        this.view.snapshot = undefined;
    }
}
