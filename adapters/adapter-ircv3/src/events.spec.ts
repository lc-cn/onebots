import { describe, expect, it } from "vitest";
import { parseIrcv3Message } from "./codec.js";
import { projectIrcv3Event } from "./events.js";
import type { Ircv3Delivery, Ircv3SessionSnapshot } from "./types.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 0,
});
const snapshot: Ircv3SessionSnapshot = {
    connected: true,
    registered: true,
    nickname: "onebots",
    availableCapabilities: {},
    enabledCapabilities: ["message-tags"],
    isupport: { CHANTYPES: "#&" },
    joinedChannels: ["#onebots"],
    operator: false,
};

function delivery(raw: string): Ircv3Delivery {
    return {
        id: "event-1",
        message: parseIrcv3Message(raw),
        receivedAt: 1_788_307_200_000,
        replayed: false,
    };
}

describe("IRCv3 canonical projection", () => {
    it("projects account-aware channel messages, replies and CTCP ACTION", () => {
        const [event] = projectIrcv3Event(
            delivery(
                "@account=alice-account;msgid=m1;+reply=m0 :Alice!u@h PRIVMSG #onebots :\u0001ACTION waves\u0001",
            ),
            { botId: createId("bot"), createId, snapshot },
        );
        expect(event).toMatchObject({
            type: "message",
            message_type: "channel",
            sender: { id: { string: "alice-account" }, name: "Alice" },
            group: { id: { string: "#onebots" } },
            message: [
                { type: "reply", data: { id: "m0" } },
                { type: "text", data: { text: "waves" } },
            ],
        });
    });

    it("projects invitations, membership and typing without dropping raw messages", () => {
        const [invite] = projectIrcv3Event(delivery(":Alice!u@h INVITE onebots #onebots"), {
            botId: createId("bot"),
            createId,
            snapshot,
        });
        expect(invite).toMatchObject({
            type: "request",
            request_type: "group",
            sub_type: "invite",
        });
        expect(invite.raw_event?.command).toBe("INVITE");

        const [joined] = projectIrcv3Event(
            delivery(":Alice!u@h JOIN #onebots alice-account :Alice Doe"),
            {
                botId: createId("bot"),
                createId,
                snapshot,
            },
        );
        expect(joined).toMatchObject({
            type: "notice",
            notice_type: "member_joined",
            user: { id: { string: "alice-account" }, account: "alice-account" },
        });

        const [typing] = projectIrcv3Event(delivery("@+typing=active :Alice!u@h TAGMSG #onebots"), {
            botId: createId("bot"),
            createId,
            snapshot,
        });
        expect(typing).toMatchObject({ type: "notice", notice_type: "typing_started" });
    });

    it("projects MODE target and operator as distinct users", () => {
        const [event] = projectIrcv3Event(delivery(":Oper!u@h MODE #onebots +ko secret Alice"), {
            botId: createId("bot"),
            createId,
            snapshot,
        });
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "group_admin",
            sub_type: "set_operator",
            user: { id: { string: "Alice" } },
            operator: { id: { string: "Oper" } },
        });
    });
});
