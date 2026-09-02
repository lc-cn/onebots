import { describe, expect, it } from "vitest";
import { Ircv3LineDecoder, formatIrcv3Message, parseIrcv3Message } from "./codec.js";
import { splitIrcv3ActionText, splitIrcv3Text } from "./messages.js";

describe("IRCv3 codec", () => {
    it("parses opaque incoming tags, prefix and trailing parameters losslessly", () => {
        const message = parseIrcv3Message(
            "@time=2026-09-02T00:00:00.000Z;+reply=a\\sb;future$key=x :nick!user@host PRIVMSG #room :hello world",
        );
        expect(message.command).toBe("PRIVMSG");
        expect(message.source).toEqual({
            raw: "nick!user@host",
            nick: "nick",
            user: "user",
            host: "host",
        });
        expect(message.params).toEqual(["#room", "hello world"]);
        expect(message.tags["+reply"]).toBe("a b");
        expect(message.tags["future$key"]).toBe("x");
        expect(parseIrcv3Message("@future=old;future=new PING :token").tags.future).toBe("new");
    });

    it("formats tags and blocks CRLF injection before writing", () => {
        expect(formatIrcv3Message("privmsg", ["#room", "hello world"], { "+reply": "a;b" })).toBe(
            "@+reply=a\\:b PRIVMSG #room :hello world\r\n",
        );
        expect(() => formatIrcv3Message("PRIVMSG", ["#room", "hello\r\nOPER root secret"])).toThrow(
            /控制字符/u,
        );
    });

    it("decodes only complete CRLF frames and rejects lone LF", () => {
        const decoder = new Ircv3LineDecoder();
        expect(decoder.push(Buffer.from(":server PING :to"))).toEqual([]);
        expect(decoder.push(Buffer.from("ken\r\n:server NOTICE me :ok\r\n"))).toEqual([
            ":server PING :token",
            ":server NOTICE me :ok",
        ]);
        expect(() => decoder.push("PING bad\n")).toThrow(/CRLF/u);
    });

    it("splits long Unicode text on UTF-8 boundaries within the 512-byte main section", () => {
        const chunks = splitIrcv3Text("PRIVMSG", "#room", "你好".repeat(300));
        expect(chunks.length).toBeGreaterThan(1);
        for (const chunk of chunks) {
            expect(Buffer.byteLength(`PRIVMSG #room :${chunk}\r\n`, "utf8")).toBeLessThanOrEqual(
                512,
            );
        }
        expect(chunks.join("")).toBe("你好".repeat(300));
        const actions = splitIrcv3ActionText("#room", "wave ".repeat(150));
        expect(actions.length).toBeGreaterThan(1);
        for (const action of actions) {
            expect(action).toMatch(/^\u0001ACTION [\s\S]+\u0001$/u);
            expect(Buffer.byteLength(`PRIVMSG #room :${action}\r\n`, "utf8")).toBeLessThanOrEqual(
                512,
            );
        }
    });

    it("enforces the independent IRCv3 tag and 512-byte main section limits", () => {
        expect(() => parseIrcv3Message(`PRIVMSG #room :${"x".repeat(500)}`)).toThrow(
            /主报文超过 512 bytes/u,
        );
        expect(() =>
            parseIrcv3Message(`@vendor/tag=${"x".repeat(8_200)} PING :token`, 16_384),
        ).toThrow(/tags section 超过 8191 bytes/u);
        expect(() =>
            formatIrcv3Message("PING", ["token"], { "+large": "x".repeat(4_100) }),
        ).toThrow(/tags section 超过 4096 bytes/u);
    });
});
