import { describe, expect, test } from "vitest";
import { assertAdapterCapabilities, listSupportedActions } from "onebots";
import { ICQQAdapter } from "./adapter.js";
import { icqqCapabilities } from "./capabilities.js";

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
            ]),
        );
    });

    test("reports package versions from installed metadata", async () => {
        const version = await ICQQAdapter.prototype.getVersion.call({} as ICQQAdapter, "unused");

        expect(version.app_version).toMatch(/^\d+\.\d+\.\d+/);
        expect(version.impl_version).toMatch(/^\d+\.\d+\.\d+/);
    });
});
