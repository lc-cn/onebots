/** Mock 平台的结构化错误，便于协议与测试精确断言失败原因。 */
export class MockError extends Error {
    readonly code: string;
    readonly details?: unknown;
    override readonly cause?: unknown;

    constructor(
        message: string,
        options: { code?: string; details?: unknown; cause?: unknown } = {},
    ) {
        super(message);
        this.name = "MockError";
        this.code = options.code || "MOCK_ERROR";
        this.details = options.details;
        this.cause = options.cause;
    }

    static wrap(error: unknown, code = "MOCK_ERROR"): MockError {
        if (error instanceof MockError) return error;
        return new MockError(error instanceof Error ? error.message : String(error), {
            code,
            cause: error,
        });
    }
}
