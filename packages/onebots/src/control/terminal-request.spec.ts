import { describe, expect, it } from "vitest";
import type { IncomingMessage } from "node:http";
import { isLocalTerminalRequest } from "./terminal-request.js";

function request(remoteAddress: string, host: string, origin?: string): IncomingMessage {
    return {
        headers: { host, ...(origin ? { origin } : {}) },
        socket: { remoteAddress },
    } as IncomingMessage;
}

describe("local terminal request", () => {
    it("仅接受回环连接与回环浏览器地址的同源组合", () => {
        expect(
            isLocalTerminalRequest(
                request("127.0.0.1", "localhost:6727", "http://localhost:6727"),
            ),
        ).toBe(true);
        expect(isLocalTerminalRequest(request("::1", "[::1]:6727"))).toBe(true);
        expect(isLocalTerminalRequest(request("192.0.2.1", "localhost:6727"))).toBe(false);
        // 同机反向代理会呈现回环 socket，但外部 URL 不能因此获得本机 shell。
        expect(
            isLocalTerminalRequest(
                request("127.0.0.1", "console.example.com", "https://console.example.com"),
            ),
        ).toBe(false);
        expect(
            isLocalTerminalRequest(
                request("127.0.0.1", "localhost:6727", "https://console.example.com"),
            ),
        ).toBe(false);
    });

    it("受文件权限保护的本地控制通道不依赖 HTTP Host", () => {
        expect(isLocalTerminalRequest(request("", "control.socket"), true)).toBe(true);
    });
});
