import { Ircv3Error } from "./errors.js";
import type { Ircv3Message } from "./types.js";

export const IRCV3_DEFAULT_ERROR_REPLIES = Object.freeze([
    "400",
    "401",
    "402",
    "403",
    "404",
    "405",
    "406",
    "407",
    "409",
    "411",
    "412",
    "417",
    "421",
    "422",
    "431",
    "432",
    "433",
    "436",
    "437",
    "441",
    "442",
    "443",
    "461",
    "462",
    "464",
    "465",
    "471",
    "472",
    "473",
    "474",
    "475",
    "476",
    "477",
    "478",
    "482",
    "485",
    "FAIL",
]);

interface PendingRequest {
    command: string;
    messages: Ircv3Message[];
    endCommands: ReadonlySet<string>;
    errorCommands: ReadonlySet<string>;
    resolve(messages: Ircv3Message[]): void;
    reject(error: Error): void;
    timer: ReturnType<typeof setTimeout>;
    signal?: AbortSignal;
    abort?: () => void;
}

/** labeled-response 与 legacy 串行查询共用的响应收集器。 */
export class Ircv3RequestManager {
    private readonly labeled = new Map<string, PendingRequest>();
    private legacy?: PendingRequest;
    private readonly batchLabels = new Map<string, string>();

    create(
        command: string,
        endCommands: readonly string[],
        errorCommands: readonly string[],
        timeoutMs: number,
        label?: string,
        signal?: AbortSignal,
    ): Promise<Ircv3Message[]> {
        if (!label && this.legacy) {
            throw new Ircv3Error("legacy IRC 查询必须串行", { code: "IRCV3_REQUEST_CONFLICT" });
        }
        return new Promise<Ircv3Message[]>((resolve, reject) => {
            const pending: PendingRequest = {
                command,
                messages: [],
                endCommands: new Set(endCommands.map(value => value.toUpperCase())),
                errorCommands: new Set(errorCommands.map(value => value.toUpperCase())),
                resolve,
                reject,
                timer: setTimeout(() => {
                    this.remove(label, pending);
                    reject(
                        new Ircv3Error(`IRC ${command} 响应超时`, {
                            code: "IRCV3_COMMAND_TIMEOUT",
                            command,
                        }),
                    );
                }, timeoutMs),
                signal,
            };
            pending.timer.unref?.();
            if (label) this.labeled.set(label, pending);
            else this.legacy = pending;
            if (signal) {
                pending.abort = () => {
                    this.remove(label, pending);
                    reject(
                        new Ircv3Error(`IRC ${command} 已取消`, {
                            code: "IRCV3_ABORTED",
                            command,
                        }),
                    );
                };
                signal.addEventListener("abort", pending.abort, { once: true });
                if (signal.aborted) pending.abort();
            }
        });
    }

    observe(message: Ircv3Message): void {
        const batch = batchChange(message);
        if (batch?.opening && typeof message.tags.label === "string") {
            this.batchLabels.set(batch.id, message.tags.label);
        }
        const batchLabel =
            typeof message.tags.batch === "string"
                ? this.batchLabels.get(message.tags.batch)
                : batch
                  ? this.batchLabels.get(batch.id)
                  : undefined;
        const label = typeof message.tags.label === "string" ? message.tags.label : batchLabel;
        const pending = label ? this.labeled.get(label) : this.legacy;
        if (pending) {
            pending.messages.push(message);
            if (batch && !batch.opening && batchLabel) {
                this.remove(batchLabel, pending);
                pending.resolve([...pending.messages]);
            } else if (!batch?.opening) this.finishIfTerminal(pending, message, label);
        }
        if (batch && !batch.opening) this.batchLabels.delete(batch.id);
    }

    reject(label: string | undefined, error: Error): void {
        const pending = label ? this.labeled.get(label) : this.legacy;
        if (!pending) return;
        this.remove(label, pending);
        pending.reject(error);
    }

    rejectAll(error: Error): void {
        for (const [label, pending] of this.labeled) {
            this.remove(label, pending);
            pending.reject(error);
        }
        if (this.legacy) {
            const pending = this.legacy;
            this.remove(undefined, pending);
            pending.reject(error);
        }
        this.batchLabels.clear();
    }

    private finishIfTerminal(pending: PendingRequest, message: Ircv3Message, label?: string): void {
        if (pending.errorCommands.has(message.command)) {
            this.remove(label, pending);
            pending.reject(serverError(pending.command, message));
            return;
        }
        if (pending.endCommands.has(message.command)) {
            this.remove(label, pending);
            pending.resolve([...pending.messages]);
        }
    }

    private remove(label: string | undefined, pending: PendingRequest): void {
        clearTimeout(pending.timer);
        if (pending.signal && pending.abort) {
            pending.signal.removeEventListener("abort", pending.abort);
        }
        if (label) {
            if (this.labeled.get(label) === pending) this.labeled.delete(label);
            for (const [batch, batchLabel] of this.batchLabels) {
                if (batchLabel === label) this.batchLabels.delete(batch);
            }
        } else if (this.legacy === pending) this.legacy = undefined;
    }
}

function batchChange(message: Ircv3Message): { id: string; opening: boolean } | undefined {
    if (message.command !== "BATCH") return undefined;
    const reference = message.params[0];
    if (!reference || !/^[+-][A-Za-z0-9-]+$/u.test(reference)) return undefined;
    return { id: reference.slice(1), opening: reference[0] === "+" };
}

function serverError(command: string, message: Ircv3Message): Ircv3Error {
    const description = message.params.at(-1) || "服务器拒绝命令";
    return new Ircv3Error(`IRC ${command} 失败: ${description}`, {
        code:
            message.command === "FAIL"
                ? message.params[1] || "IRCV3_COMMAND_FAILED"
                : `IRCV3_${message.command}`,
        command,
        status: /^\d{3}$/u.test(message.command) ? Number(message.command) : undefined,
    });
}
