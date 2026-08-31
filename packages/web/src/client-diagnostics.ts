export interface ClientDiagnostic {
    message: string;
    error?: unknown;
    timestamp: number;
}

/** 集中浏览器诊断出口，并广播给未来的 Web 日志面板或遥测插件。 */
export function reportClientError(message: string, error?: unknown): void {
    const diagnostic: ClientDiagnostic = { message, error, timestamp: Date.now() };
    if (typeof window !== "undefined") {
        window.dispatchEvent(
            new CustomEvent<ClientDiagnostic>("onebots:client-error", { detail: diagnostic }),
        );
    }
    // eslint-disable-next-line no-console -- Browser diagnostics remain visible even when no UI observer is installed.
    console.error(message, error);
}
