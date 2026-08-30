import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { OneBotV11Config } from "../config.js";
import { OneBotV11Transport } from "../transport.js";

describe("OneBot V11 transport lifecycle", () => {
    test("stop removes every HTTP reverse dispatch listener", () => {
        const emitter = new EventEmitter();
        const transport = new OneBotV11Transport({
            accountId: "bot",
            path: "/mock/bot/onebot/v11",
            config: {
                protocol: "onebot",
                version: "v11",
                use_http: false,
                use_ws: false,
                http_reverse: ["https://example.com/a", "https://example.com/b"],
                ws_reverse: [],
            } as OneBotV11Config.Config,
            router: {} as never,
            logger: {
                debug: vi.fn(),
                error: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
            },
            apply: vi.fn(),
            format: vi.fn(),
            onDispatch: listener => emitter.on("dispatch", listener),
            offDispatch: listener => emitter.off("dispatch", listener),
            dispatchEmitter: emitter,
        });

        transport.start();
        expect(emitter.listenerCount("dispatch")).toBe(2);

        transport.stop();
        expect(emitter.listenerCount("dispatch")).toBe(0);
    });
});
