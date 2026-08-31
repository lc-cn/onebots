import { describe, expect, test } from "vitest";
import { assertAdapterCapabilities, listSupportedActions } from "onebots";
import { ICQQAdapter } from "./adapter.js";
import { icqqCapabilities } from "./capabilities.js";
import { ICQQ_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("ICQQ capability manifest", () => {
    test("declares the native capability contract", () => {
        expect(() => assertAdapterCapabilities(icqqCapabilities)).not.toThrow();
        expect(listSupportedActions(icqqCapabilities)).toEqual(
            expect.arrayContaining([
                "get_message_history",
                "send_friend_nudge",
                "get_friend_requests",
                "mute_group_anonymous",
                "get_group_notifications",
                "get_guild_member_list",
                "upload_file",
                "get_group_files",
                "get_credentials",
                "set_friend_remark",
                "set_group_join_type",
                "get_group_mute_member_list",
                "delete_group_message_reaction",
            ]),
        );
    });

    test("reports package versions from installed metadata", async () => {
        const adapter = {
            requireNativeClient: () => ({
                apk: { ver: "9.1.50" },
                config: { platform: 2 },
            }),
        } as unknown as ICQQAdapter;
        const version = await ICQQAdapter.prototype.getVersion.call(adapter, "unused");

        expect(version.app_version).toMatch(/^\d+\.\d+\.\d+/);
        expect(version.impl_version).toMatch(/^\d+\.\d+\.\d+/);
        expect(version.qq_protocol_version).toBe("9.1.50");
        expect(version.qq_protocol_type).toBe("android_pad");
    });

    test("every declared action resolves to a concrete implementation", () => {
        const adapter = Object.create(ICQQAdapter.prototype) as ICQQAdapter;
        for (const action of listSupportedActions(icqqCapabilities)) {
            expect(adapter.isActionImplemented(action), action).toBe(true);
        }
        for (const action of ICQQ_PLATFORM_ACTIONS) {
            expect(icqqCapabilities.actions[action]?.support, action).toBe("native");
        }
    });

    test("declares the full native event surface", () => {
        expect(icqqCapabilities.events.message?.scenes).toEqual(["private", "group", "channel"]);
        expect(icqqCapabilities.events.friend_add?.support).toBe("native");
        expect(icqqCapabilities.events.friend_remove?.support).toBe("native");
        expect(icqqCapabilities.events.message_status?.support).toBe("native");
        expect(icqqCapabilities.events.message_deleted?.scenes).toContain("channel");
    });

    test("declares rich native segments instead of hiding them behind icqq_raw", () => {
        for (const segment of [
            "flash",
            "location",
            "poke",
            "rps",
            "dice",
            "markdown",
            "forward",
            "node",
            "file",
        ]) {
            expect(icqqCapabilities.segments[segment]?.support, segment).toBe("native");
        }
        expect(icqqCapabilities.segments.node?.direction).toBe("send");
        expect(icqqCapabilities.segments.file?.direction).toBe("receive");
    });
});
