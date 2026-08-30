import { EventEmitter } from "node:events";
import { describe, expect, test, vi } from "vitest";
import type { OneBotV12Config } from "../config.js";
import { OneBotV12Transport } from "../transport.js";

describe("OneBot V12 transport lifecycle", () => {
    test("stop removes every HTTP webhook dispatch listener", () => {
        const emitter = new EventEmitter();
        const transport = new OneBotV12Transport({
            path: "/mock/bot/onebot/v12",
            config: {
                protocol: "onebot",
                version: "v12",
                use_http: false,
                use_ws: false,
                http_webhook: ["https://example.com/a", "https://example.com/b"],
                ws_reverse: [],
            } as OneBotV12Config.Config,
            router: {} as never,
            logger: {
                error: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
            },
            apply: vi.fn(),
            getVersionInfo: vi.fn(),
            dispatchMetaEvent: vi.fn(),
            onDispatch: listener => emitter.on("dispatch", listener),
            offDispatch: listener => emitter.off("dispatch", listener),
        });

        transport.start();
        expect(emitter.listenerCount("dispatch")).toBe(2);

        transport.stop();
        expect(emitter.listenerCount("dispatch")).toBe(0);
    });
});
