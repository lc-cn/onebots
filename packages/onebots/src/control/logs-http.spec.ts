import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, expect, it, vi } from "vitest";
import type { IncomingMessage, ServerResponse } from "node:http";
import { ControlAuth } from "./auth.js";
import { appendControlLog } from "./gateway-log.js";
import { respondControlLogs } from "./logs-http.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
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
