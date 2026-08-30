import { rm } from "node:fs/promises";
import { assertAdapterCapabilityContract, BaseApp, SqliteDB } from "onebots";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ZulipAdapter } from "./adapter.js";
import { zulipCapabilities } from "./capabilities.js";
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
        expect(zulipCapabilities.transports.event_queue?.mode).toBe("polling");
        expect(zulipCapabilities.transports.manual?.support).toBe("native");
    });
});
