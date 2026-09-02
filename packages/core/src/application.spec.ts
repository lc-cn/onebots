import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApplicationRegistry, defineApplication } from "./application.js";
import { Protocol } from "./protocol.js";
import type { Account } from "./account.js";
import type { Adapter } from "./adapter.js";

class TestProtocol extends Protocol<"v1"> {
    readonly name = "test";
    readonly version = "v1" as const;
    readonly calls: string[] = [];

    start(): void {
        this.calls.push("protocol:start");
    }

    stop(): void {
        this.calls.push("protocol:stop");
    }

    dispatch(event: unknown): void {
        this.calls.push(`protocol:dispatch:${String(event)}`);
    }

    format(_event: string, payload: unknown): unknown {
        return payload;
    }

    async apply(action: string): Promise<unknown> {
        this.calls.push(`protocol:apply:${action}`);
        return action;
    }
}

describe("ApplicationRegistry", () => {
    beforeEach(() => ApplicationRegistry.clear());
    afterEach(() => ApplicationRegistry.clear());

    it("按激活顺序把生命周期、动作和事件扩展组合到协议实例", async () => {
        ApplicationRegistry.register(
            defineApplication({
                name: "zhin",
                displayName: "Zhin",
                description: "test",
                createProtocolExtension(protocol) {
                    if (protocol.name !== "test") return undefined;
                    return {
                        capability: {
                            connections: [],
                            actions: ["zhin_ping"],
                            routes: ["/zhin"],
                            limitations: [],
                        },
                        async start({ protocol, next }) {
                            (protocol as TestProtocol).calls.push("zhin:start:before");
                            await next();
                            (protocol as TestProtocol).calls.push("zhin:start:after");
                        },
                        async stop({ protocol, next }) {
                            (protocol as TestProtocol).calls.push("zhin:stop");
                            await next();
                        },
                        async apply({ action, next }) {
                            return action === "zhin_ping" ? "pong" : next();
                        },
                        async dispatch({ event, next }) {
                            await next(`zhin:${String(event)}`);
                        },
                    };
                },
            }),
        );
        ApplicationRegistry.activate("zhin");
        const protocol = createProtocol();
        ApplicationRegistry.extend(protocol);

        await protocol.start();
        expect(await protocol.apply("zhin_ping")).toBe("pong");
        expect(await protocol.apply("native")).toBe("native");
        await protocol.dispatch("event");
        await protocol.stop();

        expect(protocol.calls).toEqual([
            "zhin:start:before",
            "protocol:start",
            "zhin:start:after",
            "protocol:apply:native",
            "protocol:dispatch:zhin:event",
            "zhin:stop",
            "protocol:stop",
        ]);
        expect(ApplicationRegistry.describeProtocol(protocol)).toMatchObject([
            {
                application: "zhin",
                protocol: "test.v1",
                status: "supported",
                actions: ["zhin_ping"],
                routes: ["/zhin"],
            },
        ]);
    });

    it("对未适配协议公开明确的 unsupported 能力", () => {
        ApplicationRegistry.register(
            defineApplication({
                name: "zhin",
                displayName: "Zhin",
                description: "test",
                createProtocolExtension: () => undefined,
                unsupportedProtocol: protocol => [
                    `unsupported:${protocol.name}.${protocol.version}`,
                ],
            }),
        );
        ApplicationRegistry.activate("zhin");
        const protocol = createProtocol();
        ApplicationRegistry.extend(protocol);

        expect(ApplicationRegistry.describeProtocol(protocol)).toMatchObject([
            {
                status: "unsupported",
                limitations: ["unsupported:test.v1"],
            },
        ]);
    });

    it("拒绝重复身份并保持重复激活幂等", () => {
        const definition = defineApplication({
            name: "zhin",
            displayName: "Zhin",
            description: "test",
            createProtocolExtension: vi.fn(() => undefined),
        });
        ApplicationRegistry.register(definition);
        ApplicationRegistry.register(definition);
        ApplicationRegistry.activate("zhin");
        ApplicationRegistry.activate("zhin");
        expect(ApplicationRegistry.getActiveNames()).toEqual(["zhin"]);
        expect(() => ApplicationRegistry.register({ ...definition })).toThrow(
            "应用 zhin 已由其他实现注册",
        );
    });

    it("注册调研项但拒绝把它当作可运行扩展激活", () => {
        ApplicationRegistry.register({
            name: "avilla",
            displayName: "Avilla",
            description: "planned",
            stage: "planned",
            createProtocolExtension: () => undefined,
        });
        expect(ApplicationRegistry.getNames()).toContain("avilla");
        expect(() => ApplicationRegistry.activate("avilla")).toThrow("应用 avilla 仍处于调研阶段");
    });

    it.each(["experimental", "legacy"] as const)("允许激活 %s 阶段并保留运行时状态", stage => {
        ApplicationRegistry.register({
            name: stage,
            displayName: stage,
            description: stage,
            stage,
            createProtocolExtension: () => undefined,
        });

        ApplicationRegistry.activate(stage);

        expect(ApplicationRegistry.listActive()).toEqual([
            expect.objectContaining({ name: stage, stage }),
        ]);
    });
});

function createProtocol(): TestProtocol {
    const adapter = { app: { getLogger: vi.fn(), router: {} } } as unknown as Adapter;
    const account = { path: "/mock/main" } as unknown as Account;
    return new TestProtocol(adapter, account, { protocol: "test", version: "v1" });
}
