import type { PlatformActionHandler } from "onebots";
import { exactParams, requireBoolean, requireString } from "./action-params.js";
import type { ZulipClient } from "./client.js";

/** Zulip 服务端已配置的视频会议集成。 */
export const ZULIP_VIDEO_CALL_ACTION_HANDLERS = {
    create_bigbluebutton_call: (client, params) => {
        const input = exactParams(params, ["meeting_name", "voice_only"], ["meeting_name"]);
        requireString(input.meeting_name, "meeting_name");
        if (input.voice_only !== undefined) requireBoolean(input.voice_only, "voice_only");
        return client.call("calls/bigbluebutton/create", "GET", input);
    },
    create_nextcloud_talk_call: (client, params) => {
        const input = exactParams(params, ["room_name"], ["room_name"]);
        requireString(input.room_name, "room_name");
        return client.call("calls/nextcloud_talk/create", "POST", input);
    },
    create_webex_call: (client, params) => {
        exactParams(params, []);
        return client.call("calls/webex/create", "POST");
    },
    create_constructor_groups_call: (client, params) => {
        exactParams(params, []);
        return client.call("calls/constructorgroups/create", "POST");
    },
} satisfies Readonly<Record<string, PlatformActionHandler<ZulipClient>>>;
