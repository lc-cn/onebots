import type { ControlClient, ControlUpdatePlan } from "@onebots/core/control";

/** 仅生成预览；安装及激活继续由安装面板的唯一持久跟踪链负责。 */
export function createControlUpdateCheck(options: {
    client(): Pick<ControlClient, "configurationSource" | "planUpdate">;
    blocked(): boolean;
    bounded<T>(promise: Promise<T>): Promise<T>;
    begin(): void;
    accept(result: ControlUpdatePlan): void;
    fail(reason: "damaged" | "unavailable"): void;
    end(): void;
}) {
    let running = false;
    let disposed = false;
    let epoch = 0;
    return {
        async run(): Promise<void> {
            if (disposed || running || options.blocked()) return;
            running = true;
            const request = ++epoch;
            const current = () => !disposed && request === epoch && options.client() === client;
            const client = options.client();
            options.begin();
            try {
                const snapshot = await options.bounded(client.configurationSource());
                if (!current()) return;
                if (snapshot.state === "damaged") {
                    options.fail("damaged");
                    return;
                }
                if (snapshot.state !== "ready") throw new Error("source");
                const base = snapshot.base;
                if (
                    !base ||
                    !(base.generationId === null || typeof base.generationId === "string") ||
                    !/^[a-f0-9]{64}$/.test(base.configRevision)
                )
                    throw new Error("snapshot");
                const expected = {
                    generationId: base.generationId,
                    configRevision: base.configRevision,
                };
                const result = await boundedControlRequest(client.planUpdate(expected), 120_000);
                if (!current()) return;
                if (
                    !validPreview(result) ||
                    result.base?.generationId !== expected.generationId ||
                    result.base?.configRevision !== expected.configRevision ||
                    !["current", "updates_available"].includes(result.state) ||
                    (result.state === "updates_available" &&
                        (!result.installationPlan ||
                            result.installationPlan.baseGenerationId !== expected.generationId)) ||
                    (result.state === "current" && result.installationPlan)
                )
                    throw new Error("identity");
                options.accept(result);
            } catch {
                if (current()) options.fail("unavailable");
            } finally {
                running = false;
                if (!disposed && request === epoch) options.end();
            }
        },
        isRunning: () => running,
        dispose(): void {
            disposed = true;
            epoch++;
        },
    };
}

function validPreview(result: ControlUpdatePlan): boolean {
    if (
        !Array.isArray(result.packages) ||
        result.packages.length < 2 ||
        !result.packages.every(
            item =>
                item &&
                typeof item.name === "string" &&
                (item.current === null || typeof item.current === "string") &&
                typeof item.target === "string",
        ) ||
        new Set(result.packages.map(item => item.name)).size !== result.packages.length ||
        !Array.isArray(result.peers) ||
        !result.peers.every(
            peer =>
                peer &&
                typeof peer.requestedBy === "string" &&
                typeof peer.packageName === "string" &&
                typeof peer.range === "string",
        ) ||
        !Array.isArray(result.recommendations) ||
        !result.recommendations.every(item => typeof item === "string")
    )
        return false;
    if (result.state === "current") return result.installationPlan === undefined;
    const plan = result.installationPlan;
    if (
        !plan ||
        !/^[a-f0-9]{64}$/.test(plan.id) ||
        !/^[a-f0-9]{64}$/.test(plan.planDigest) ||
        !plan.selection ||
        ![plan.selection.adapters, plan.selection.protocols, plan.selection.applications].every(
            items => Array.isArray(items) && items.every(item => typeof item === "string"),
        ) ||
        !Array.isArray(plan.packages) ||
        plan.packages.length !== result.packages.length ||
        !plan.packages.every(
            item =>
                item &&
                result.packages.some(
                    target => item.name === target.name && item.version === target.target,
                ),
        ) ||
        new Set(plan.packages.map(item => item.name)).size !== plan.packages.length
    )
        return false;
    return (
        JSON.stringify(plan.peers) === JSON.stringify(result.peers) &&
        JSON.stringify(plan.recommendations) === JSON.stringify(result.recommendations)
    );
}

/** 请求超时只表示结果未确认；晚到的只读预览不会被采纳或触发安装。 */
export async function boundedControlRequest<T>(
    promise: Promise<T>,
    milliseconds = 15_000,
): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<never>((_, reject) => {
                timer = setTimeout(() => reject(new Error("timeout")), milliseconds);
            }),
        ]);
    } finally {
        clearTimeout(timer);
    }
}
