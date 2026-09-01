export const TERMINAL_MAX_INPUT_BYTES = 64 * 1024;
export const TERMINAL_MAX_COLUMNS = 1000;
export const TERMINAL_MAX_ROWS = 1000;

export type TerminalClientCommand =
    | { type: "input"; data: string }
    | { type: "resize"; cols: number; rows: number }
    | { type: "restart" };

export interface TerminalClientMessageError {
    type: "error";
    code: "INVALID_JSON" | "INVALID_MESSAGE" | "UNKNOWN_ACTION";
    message: string;
}

export type TerminalClientMessageResult =
    | { success: true; command: TerminalClientCommand }
    | { success: false; error: TerminalClientMessageError };

/** 在数据进入原生 PTY 前闭合旧客户端与当前 Web 控制台共用的消息契约。 */
export function parseTerminalClientMessage(raw: string): TerminalClientMessageResult {
    let payload: unknown;
    try {
        payload = JSON.parse(raw);
    } catch {
        return failure("INVALID_JSON", "终端消息必须是有效 JSON");
    }
    if (!isRecord(payload) || typeof payload.type !== "string") {
        return failure("INVALID_MESSAGE", "终端消息必须包含字符串 type");
    }

    switch (payload.type) {
        case "input": {
            if (typeof payload.data !== "string") {
                return failure("INVALID_MESSAGE", "终端输入 data 必须是字符串");
            }
            if (Buffer.byteLength(payload.data, "utf8") > TERMINAL_MAX_INPUT_BYTES) {
                return failure(
                    "INVALID_MESSAGE",
                    `终端输入不能超过 ${TERMINAL_MAX_INPUT_BYTES} 字节`,
                );
            }
            return { success: true, command: { type: "input", data: payload.data } };
        }
        case "resize": {
            if (!validDimension(payload.cols, TERMINAL_MAX_COLUMNS)) {
                return failure(
                    "INVALID_MESSAGE",
                    `终端列数必须是 1 到 ${TERMINAL_MAX_COLUMNS} 的整数`,
                );
            }
            if (!validDimension(payload.rows, TERMINAL_MAX_ROWS)) {
                return failure(
                    "INVALID_MESSAGE",
                    `终端行数必须是 1 到 ${TERMINAL_MAX_ROWS} 的整数`,
                );
            }
            return {
                success: true,
                command: { type: "resize", cols: payload.cols, rows: payload.rows },
            };
        }
        case "restart":
            return { success: true, command: { type: "restart" } };
        default:
            return failure("UNKNOWN_ACTION", "未知终端动作");
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validDimension(value: unknown, maximum: number): value is number {
    return Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= maximum;
}

function failure(
    code: TerminalClientMessageError["code"],
    message: string,
): TerminalClientMessageResult {
    return { success: false, error: { type: "error", code, message } };
}
