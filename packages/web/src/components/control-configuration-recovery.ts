import { ControlRequestError, type ControlConfigurationOperation } from "@onebots/core/control";

export interface ConfigurationTracking {
    draftId?: string;
    operationId?: string;
    receiptId?: string;
}
interface Submission {
    operationId: string;
    receiptId: string;
}
/** 只有当前新提交的身份仍匹配，且服务端明确证实无记录，才可解除提交锁。 */
export async function resolveConfigurationConflict(input: {
    error: unknown;
    newlySubmitted: boolean;
    submitted: Submission;
    current(): ConfigurationTracking;
    lookup(id: string): Promise<ControlConfigurationOperation>;
}): Promise<{ clear: boolean; existing?: ControlConfigurationOperation }> {
    const matches = () => {
        try {
            const current = input.current();
            return (
                current.operationId === input.submitted.operationId &&
                current.receiptId === input.submitted.receiptId
            );
        } catch {
            return false;
        }
    };
    if (
        !input.newlySubmitted ||
        !(input.error instanceof ControlRequestError) ||
        input.error.status !== 409 ||
        !matches()
    )
        return { clear: false };
    try {
        const existing = await input.lookup(input.submitted.operationId);
        return {
            clear: false,
            ...(matches() && existing.id === input.submitted.operationId ? { existing } : {}),
        };
    } catch (error) {
        return { clear: error instanceof ControlRequestError && error.status === 404 && matches() };
    }
}

export function matchingConfigurationTracking(
    memory: ConfigurationTracking,
    stored: string | null,
): ConfigurationTracking {
    const saved = readConfigurationTracking(stored);
    return saved.operationId === memory.operationId && saved.receiptId === memory.receiptId
        ? memory
        : {};
}

export function readConfigurationTracking(source: string | null): ConfigurationTracking {
    const value: unknown = JSON.parse(source ?? "{}");
    if (!value || typeof value !== "object") return {};
    const stored = value as Record<string, unknown>;
    const valid = (value: unknown): value is string =>
        typeof value === "string" && /^[a-f0-9-]{36}$/.test(value);
    return {
        ...(valid(stored.draftId) ? { draftId: stored.draftId } : {}),
        ...(valid(stored.operationId) && valid(stored.receiptId)
            ? { operationId: stored.operationId, receiptId: stored.receiptId }
            : {}),
    };
}

export async function configurationRequest<T>(promise: Promise<T>): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timeout = setTimeout(() => reject(new Error("timeout")), 15_000);
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
}
