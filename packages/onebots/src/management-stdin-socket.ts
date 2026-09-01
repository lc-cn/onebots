export interface ManagementStdinSocketRequest {
    action?: unknown;
    data?: unknown;
    echo?: unknown;
}

export interface ManagementStdinSocketResponse {
    event: "system.input.result";
    echo?: unknown;
    data: { success: true } | { success: false; code: "INPUT_INVALID"; message: string };
}

interface ManagementStdin {
    resume(): unknown;
    emit(event: "data", chunk: Buffer): boolean;
}

/** 处理旧管理 WebSocket 的 stdin 兼容动作，不结束进程级输入流。 */
export function handleManagementStdinSocketAction(
    request: ManagementStdinSocketRequest,
    stdin: ManagementStdin = process.stdin,
): ManagementStdinSocketResponse | undefined {
    if (request.action !== "system.input") return undefined;
    if (typeof request.data !== "string") {
        return response(request, {
            success: false,
            code: "INPUT_INVALID",
            message: "终端输入必须是字符串",
        });
    }

    stdin.resume();
    const chunk = Buffer.from(`${request.data}\n`, "utf8");
    process.nextTick(() => stdin.emit("data", chunk));
    return response(request, { success: true });
}

function response(
    request: ManagementStdinSocketRequest,
    data: ManagementStdinSocketResponse["data"],
): ManagementStdinSocketResponse {
    return request.echo === undefined
        ? { event: "system.input.result", data }
        : { event: "system.input.result", echo: request.echo, data };
}
