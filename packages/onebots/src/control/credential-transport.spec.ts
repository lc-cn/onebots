import type { IncomingMessage } from "node:http";
import { describe, expect, it } from "vitest";
import { allowsControlCredentials, trustedControlProxyAddresses } from "./credential-transport.js";

function request(address: string, proto?: string, encrypted = false): IncomingMessage {
    return {
        socket: { remoteAddress: address, encrypted },
        headers: proto ? { "x-forwarded-proto": proto } : {},
        rawHeaders: proto ? ["X-Forwarded-Proto", proto] : [],
    } as unknown as IncomingMessage;
}

describe("控制秘密传输边界", () => {
    it("私有控制、本机回环及直接 TLS 可提交秘密", () => {
        expect(allowsControlCredentials(request("192.0.2.10"), true, [])).toBe(true);
        for (const address of ["127.0.0.1", "::1", "::ffff:127.0.0.1"])
            expect(allowsControlCredentials(request(address), false, [])).toBe(true);
        expect(allowsControlCredentials(request("192.0.2.10", undefined, true), false, [])).toBe(
            true,
        );
    });

    it("远程明文和不可信客户端伪造的 HTTPS 转发头不能提交秘密", () => {
        expect(allowsControlCredentials(request("192.0.2.10"), false, [])).toBe(false);
        expect(allowsControlCredentials(request("192.0.2.10", "https"), false, [])).toBe(false);
        const trusted = trustedControlProxyAddresses(["192.0.2.20"]);
        expect(allowsControlCredentials(request("192.0.2.10", "https"), false, trusted)).toBe(
            false,
        );
    });

    it("明确配置的可信代理只允许单个 HTTPS 声明，匹配双栈地址", () => {
        const trusted = trustedControlProxyAddresses(undefined, "192.0.2.20, 2001:db8::1");
        for (const address of ["192.0.2.20", "::ffff:192.0.2.20", "2001:db8:0:0:0:0:0:1"])
            expect(allowsControlCredentials(request(address, "https"), false, trusted)).toBe(true);
        for (const proto of [undefined, "http", "https,http", "https, https"])
            expect(allowsControlCredentials(request("192.0.2.20", proto), false, trusted)).toBe(
                false,
            );
        const duplicate = request("192.0.2.20", "https");
        duplicate.rawHeaders.push("x-forwarded-proto", "https");
        expect(allowsControlCredentials(duplicate, false, trusted)).toBe(false);
    });

    it("默认不信任代理，拒绝通配、网段或主机名配置", () => {
        expect(trustedControlProxyAddresses(undefined, undefined)).toEqual([]);
        expect(trustedControlProxyAddresses([], "192.0.2.20")).toEqual([]);
        for (const invalid of ["*", "192.0.2.0/24", "proxy.example", "192.0.2.20,"])
            expect(() => trustedControlProxyAddresses(undefined, invalid)).toThrow("可信代理地址");
    });
});
