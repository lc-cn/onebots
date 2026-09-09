export interface WindowsNativeStatus {
    version: 2;
    requestId: string;
    ok: true;
    state: {
        service: "starting" | "running" | "stopping" | "stopped" | "failed";
        manager: { state: "running" | "stopping" | "stopped" | "exited"; pid?: number };
        startedAt: string;
        control?: {
            revision: number;
            publishedAt: string;
            manager: { id: string; version: string; pid: number };
            gateway: {
                desired: "running" | "stopped";
                actual: "starting" | "running" | "stopping" | "stopped" | "failed";
            };
        };
    };
}

export const WINDOWS_CONTROL_FRESHNESS_MS = 30_000;

export function windowsServiceUnavailable(): never {
    throw new Error("无法安全确认 Windows SCM 管理服务状态");
}

export function isPlainWindowsStatusObject(
    value: unknown,
): value is Record<string, unknown> {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        [Object.prototype, null].includes(Object.getPrototypeOf(value))
    );
}

export function hasExactWindowsStatusKeys(
    value: Record<string, unknown>,
    expected: string[],
): boolean {
    const keys = Reflect.ownKeys(value);
    return (
        keys.length === expected.length &&
        keys.every(key => typeof key === "string" && expected.includes(key))
    );
}

export function parseSingleWindowsStatusLine(output: string, limit: number): string {
    if (output.length > limit || output.includes("\u0000")) windowsServiceUnavailable();
    const value = output.endsWith("\r\n")
        ? output.slice(0, -2)
        : output.endsWith("\n")
          ? output.slice(0, -1)
          : output;
    if (!value || /[\r\n]/.test(value)) windowsServiceUnavailable();
    return value;
}

export function parseWindowsNativeStatus(
    output: string,
    now: number = Date.now(),
): WindowsNativeStatus {
    const text = parseSingleWindowsStatusLine(output, 65_536);
    let value: unknown;
    try {
        value = JSON.parse(text);
    } catch {
        windowsServiceUnavailable();
    }
    if (
        !isPlainWindowsStatusObject(value) ||
        !hasExactWindowsStatusKeys(value, ["version", "requestId", "ok", "state"])
    )
        windowsServiceUnavailable();
    if (
        value.version !== 2 ||
        value.ok !== true ||
        typeof value.requestId !== "string" ||
        !/^[A-Za-z0-9._:-]{1,64}$/.test(value.requestId)
    )
        windowsServiceUnavailable();
    const state = value.state;
    if (
        !isPlainWindowsStatusObject(state) ||
        !hasExactWindowsStatusKeys(
            state,
            state.control === undefined
                ? ["service", "manager", "startedAt"]
                : ["service", "manager", "startedAt", "control"],
        )
    )
        windowsServiceUnavailable();
    const manager = state.manager;
    if (
        !isPlainWindowsStatusObject(manager) ||
        !hasExactWindowsStatusKeys(manager, manager.pid === undefined ? ["state"] : ["state", "pid"])
    )
        windowsServiceUnavailable();
    if (
        !["starting", "running", "stopping", "stopped", "failed"].includes(
            String(state.service),
        ) ||
        !["running", "stopping", "stopped", "exited"].includes(String(manager.state)) ||
        typeof state.startedAt !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(state.startedAt) ||
        !Number.isFinite(Date.parse(state.startedAt)) ||
        manager.state !== "running" ||
        typeof manager.pid !== "number" ||
        !Number.isSafeInteger(manager.pid) ||
        manager.pid < 1 ||
        manager.pid > 0xffffffff
    )
        windowsServiceUnavailable();
    if (state.control !== undefined) {
        const control = state.control;
        if (
            !isPlainWindowsStatusObject(control) ||
            !hasExactWindowsStatusKeys(control, ["revision", "publishedAt", "manager", "gateway"])
        )
            windowsServiceUnavailable();
        const controlManager = control.manager;
        const gateway = control.gateway;
        if (
            typeof control.revision !== "number" ||
            !Number.isSafeInteger(control.revision) ||
            control.revision < 1 ||
            typeof control.publishedAt !== "string" ||
            !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(control.publishedAt) ||
            !Number.isFinite(Date.parse(control.publishedAt)) ||
            now - Date.parse(control.publishedAt) < 0 ||
            now - Date.parse(control.publishedAt) > WINDOWS_CONTROL_FRESHNESS_MS ||
            !isPlainWindowsStatusObject(controlManager) ||
            !hasExactWindowsStatusKeys(controlManager, ["id", "version", "pid"]) ||
            typeof controlManager.id !== "string" ||
            !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
                controlManager.id,
            ) ||
            typeof controlManager.version !== "string" ||
            controlManager.version.length > 128 ||
            !/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(
                controlManager.version,
            ) ||
            controlManager.pid !== manager.pid ||
            !isPlainWindowsStatusObject(gateway) ||
            !hasExactWindowsStatusKeys(gateway, ["desired", "actual"]) ||
            !["running", "stopped"].includes(String(gateway.desired)) ||
            !["starting", "running", "stopping", "stopped", "failed"].includes(
                String(gateway.actual),
            )
        )
            windowsServiceUnavailable();
    }
    return value as unknown as WindowsNativeStatus;
}
