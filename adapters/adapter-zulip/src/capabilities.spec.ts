import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZulipAdapter } from "./adapter.js";
import { describeZulipCapabilities, zulipCapabilities } from "./capabilities.js";
import { ZULIP_PLATFORM_ACTIONS } from "./platform-actions.js";

const databasePath = `/tmp/onebots-zulip-capabilities-${process.pid}`;

describe("Zulip 能力清单", () => {
    let database: SqliteDB;
    let adapter: ZulipAdapter;

    beforeEach(() => {
        database = new SqliteDB(databasePath);
        adapter = new ZulipAdapter({
            db: database,
            config: { general: {} },
            getLogger: () => ({
                trace: vi.fn(),
                debug: vi.fn(),
                info: vi.fn(),
                warn: vi.fn(),
                error: vi.fn(),
                fatal: vi.fn(),
                mark: vi.fn(),
            }),
        } as unknown as BaseApp);
    });

    afterEach(async () => {
        database.close();
        await rm(`${databasePath}.db`, { force: true });
    });

    it("动作清单与实现闭合且不伪装好友能力", async () => {
        await assertAdapterCapabilityContract(adapter);
        for (const action of ZULIP_PLATFORM_ACTIONS) {
            expect(zulipCapabilities.actions[action]?.support).toBe("native");
        }
        expect(zulipCapabilities.actions.get_friend_list).toBeUndefined();
        expect(zulipCapabilities.actions.upload_own_avatar).toMatchObject({
            support: "native",
            availability: "permission",
            permissions: ["Zulip 组织资料与头像修改策略"],
        });
        expect(zulipCapabilities.actions.create_channel_folder).toMatchObject({
            support: "native",
            availability: "permission",
            permissions: ["Zulip 组织管理员"],
        });
        expect(zulipCapabilities.actions.add_default_channel).toMatchObject({
            support: "native",
            availability: "permission",
            permissions: ["Zulip 组织管理员"],
        });
        expect(zulipCapabilities.events.default_channels_updated?.support).toBe("native");
        expect(zulipCapabilities.actions.deactivate_organization).toMatchObject({
            availability: "permission",
            permissions: ["Zulip 组织 Owner"],
        });
        expect(zulipCapabilities.actions.deactivate_own_account?.note).toContain("破坏性操作");
        expect(zulipCapabilities.actions.regenerate_own_api_key?.note).toContain("重配 Client");
        expect(zulipCapabilities.transports.event_queue?.mode).toBe("polling");
        expect(zulipCapabilities.transports.manual?.support).toBe("native");
    });

    it("按 Event Queue event_types 展示真实可达事件", () => {
        const capabilities = describeZulipCapabilities({
            receive_mode: "event_queue",
            event_queue: { event_types: ["message", "reaction"] },
        });

        expect(capabilities.events.message?.support).toBe("native");
        expect(capabilities.events.reaction_added?.support).toBe("native");
        expect(capabilities.events.reaction_removed?.support).toBe("native");
        expect(capabilities.events.channel_created).toMatchObject({
            support: "unsupported",
            availability: "context",
        });
        expect(capabilities.events.channel_created?.note).toContain("event_queue.event_types");
        expect(capabilities.events.raw_event?.support).toBe("native");
    });

    it("默认订阅反映内置 Event Queue 集合，manual 不推断外部订阅", () => {
        const defaults = describeZulipCapabilities({ receive_mode: "event_queue" });
        expect(defaults.events.message?.support).toBe("native");
        expect(defaults.events.default_channels_updated?.support).toBe("unsupported");
        expect(
            describeZulipCapabilities({
                receive_mode: "manual",
                event_queue: { event_types: ["message"] },
            }),
        ).toBe(zulipCapabilities);
    });

    it("适配器按账号配置返回动态清单", () => {
        const dynamicAdapter = {
            getAccount: (accountId: string) =>
                accountId === "messages"
                    ? {
                          config: {
                              account_id: accountId,
                              receive_mode: "event_queue",
                              event_queue: { event_types: ["message"] },
                          },
                      }
                    : undefined,
        } as unknown as ZulipAdapter;

        expect(
            ZulipAdapter.prototype.describeCapabilities.call(dynamicAdapter, "messages").events
                .message?.support,
        ).toBe("native");
        expect(
            ZulipAdapter.prototype.describeCapabilities.call(dynamicAdapter, "messages").events
                .reaction_added?.support,
        ).toBe("unsupported");
        expect(ZulipAdapter.prototype.describeCapabilities.call(dynamicAdapter, "missing")).toBe(
            zulipCapabilities,
        );
    });
});
