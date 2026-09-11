import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
    IncomingMessage as NodeIncomingMessage,
    ServerResponse as NodeServerResponse,
} from "node:http";
import { Socket } from "node:net";
import { ControlAuth } from "./auth.js";
import { appendControlLog } from "./gateway-log.js";
import { respondControlLogs } from "./logs-http.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
    vi.useRealTimers();
});

function fixture(url: string) {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ob-logs-http-"));
    roots.push(workspace);
    const control = path.join(workspace, ".control");
    fs.mkdirSync(control, { mode: 0o700 });
    const writeHead = vi.fn();
    const end = vi.fn();
    const request = { method: "GET", url, headers: {} } as IncomingMessage;
    const response = { writeHead, end } as unknown as ServerResponse;
    const auth = new ControlAuth({ statePath: path.join(control, "auth.json") });
    return { workspace, request, response, auth, writeHead, end };
}

it("统一 HTTP seam 只接受固定来源与安全游标", () => {
    const valid = fixture("/api/control/logs?source=manager");
    appendControlLog(valid.workspace, "manager", "ready\n");
    expect(
        respondControlLogs(
            valid.workspace,
            valid.request,
            valid.response,
            "/api/control/logs",
            true,
            valid.auth,
        ),
    ).toBe(true);
    expect(valid.writeHead).toHaveBeenCalledWith(200, expect.any(Object));
    expect(JSON.parse(valid.end.mock.calls[0][0])).toMatchObject({
        schemaVersion: 1,
        source: "manager",
        text: "ready\n",
    });

    for (const query of [
        "source=secret",
        "source=manager&path=/secret",
        "source=manager&cursor=0123456789abcdef.9999999999999999",
    ]) {
        const invalid = fixture(`/api/control/logs?${query}`);
        respondControlLogs(
            invalid.workspace,
            invalid.request,
            invalid.response,
            "/api/control/logs",
            true,
            invalid.auth,
        );
        expect(invalid.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
    }
});

it("SSE 首帧立即返回尾部、随后只返回增量，断开后停止轮询", async () => {
    vi.useFakeTimers();
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "ob-logs-stream-"));
    roots.push(workspace);
    const control = path.join(workspace, ".control");
    fs.mkdirSync(control, { mode: 0o700 });
    appendControlLog(workspace, "manager", "first\n");
    const request = new NodeIncomingMessage(new Socket());
    request.method = "GET";
    request.url = "/api/control/logs/stream?source=manager";
    const response = new NodeServerResponse(request);
    const writeHead = vi.spyOn(response, "writeHead");
    const write = vi.spyOn(response, "write").mockReturnValue(true);
    const destroy = vi.spyOn(response, "destroy").mockReturnValue(response);
    const auth = { verify: vi.fn(() => true) } as unknown as ControlAuth;

    expect(
        respondControlLogs(workspace, request, response, "/api/control/logs/stream", true, auth),
    ).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(writeHead).toHaveBeenCalledWith(
        200,
        expect.objectContaining({ "Content-Type": "text/event-stream; charset=utf-8" }),
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0][0]).toContain('"text":"first\\n"');

    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(1);
    appendControlLog(workspace, "manager", "second\n");
    await vi.advanceTimersByTimeAsync(500);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1][0]).toContain('"text":"second\\n"');
    expect(write.mock.calls[1][0]).not.toContain("first");

    response.emit("close");
    expect(destroy).toHaveBeenCalledTimes(1);
    appendControlLog(workspace, "manager", "ignored\n");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(write).toHaveBeenCalledTimes(2);
});

it("SSE 复用认证和固定查询参数边界", () => {
    const denied = fixture("/api/control/logs/stream?source=gateway");
    const verify = vi.spyOn(denied.auth, "verify").mockReturnValue(false);
    denied.request.headers.authorization = "Bearer device-session";
    respondControlLogs(
        denied.workspace,
        denied.request,
        denied.response,
        "/api/control/logs/stream",
        false,
        denied.auth,
    );
    expect(verify).toHaveBeenCalledWith("device-session");
    expect(denied.writeHead).toHaveBeenCalledWith(401, expect.any(Object));

    const invalid = fixture("/api/control/logs/stream?source=manager&path=/etc/passwd");
    respondControlLogs(
        invalid.workspace,
        invalid.request,
        invalid.response,
        "/api/control/logs/stream",
        true,
        invalid.auth,
    );
    expect(invalid.writeHead).toHaveBeenCalledWith(400, expect.any(Object));
});
