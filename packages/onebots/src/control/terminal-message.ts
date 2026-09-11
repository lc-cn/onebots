export const TERMINAL_MAX_INPUT_BYTES = 64 * 1024;
export const TERMINAL_MAX_COLUMNS = 500;
export const TERMINAL_MAX_ROWS = 200;

export type TerminalClientCommand =
    | { type: "input"; data: string }
    | { type: "resize"; cols: number; rows: number };

export type TerminalClientMessageResult =
    | { command: TerminalClientCommand }
    | { error: { type: "error"; code: "INVALID_MESSAGE"; message: string } };

/** 原生 PTY 前的唯一输入边界；终端协议不承载服务生命周期操作。 */
export function parseTerminalClientMessage(raw: string): TerminalClientMessageResult {
    let value: unknown;
    try {
        value = JSON.parse(raw);
    } catch {
        return failure("终端消息必须是有效 JSON");
    }
    if (!record(value) || typeof value.type !== "string")
        return failure("终端消息必须包含字符串 type");
    if (value.type === "input") {
        if (
            typeof value.data !== "string" ||
            Buffer.byteLength(value.data, "utf8") > TERMINAL_MAX_INPUT_BYTES
        )
            return failure(`终端输入不能超过 ${TERMINAL_MAX_INPUT_BYTES} 字节`);
        return { command: { type: "input", data: value.data } };
    }
    if (value.type === "resize") {
        if (!dimension(value.cols, TERMINAL_MAX_COLUMNS))
            return failure(`终端列数必须是 1 到 ${TERMINAL_MAX_COLUMNS} 的整数`);
        if (!dimension(value.rows, TERMINAL_MAX_ROWS))
            return failure(`终端行数必须是 1 到 ${TERMINAL_MAX_ROWS} 的整数`);
        return { command: { type: "resize", cols: value.cols, rows: value.rows } };
    }
    return failure("未知终端动作");
}

function record(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function dimension(value: unknown, maximum: number): value is number {
    return Number.isSafeInteger(value) && Number(value) >= 1 && Number(value) <= maximum;
}

function failure(message: string): TerminalClientMessageResult {
    return { error: { type: "error", code: "INVALID_MESSAGE", message } };
}
