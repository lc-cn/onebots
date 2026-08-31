import { ErrorHandler, type OneBotsError } from "./errors.js";

export async function rollbackFailedStart(
    error: unknown,
    cleanup: () => Promise<void>,
    logFatal: (error: OneBotsError) => void,
): Promise<never> {
    const startupError = ErrorHandler.wrap(error, { operation: "start" });
    let finalError: unknown = startupError;

    try {
        await cleanup();
    } catch (rollbackError) {
        finalError = new AggregateError(
            [startupError, rollbackError],
            "应用启动失败且回滚未完整完成",
        );
    }

    const wrappedError = ErrorHandler.wrap(finalError, { operation: "start" });
    logFatal(wrappedError);
    throw wrappedError;
}
