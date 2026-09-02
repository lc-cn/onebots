import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { parseIrcv3Message } from "./codec.js";
import { Ircv3Client } from "./client.js";
import type { Ircv3Delivery, Ircv3Socket } from "./types.js";

class FakeSocket extends EventEmitter {
    readonly writes: string[] = [];
    ended = false;

    write(data: string): boolean {
        this.writes.push(data);
        return true;
    }

    end(): void {
        this.ended = true;
    }

    line(value: string): void {
        this.emit("data", Buffer.from(`${value}\r\n`));
    }
}

function config() {
    return {
        account_id: "libera-bot",
        host: "irc.example.com",
        nickname: "onebots",
        channels: [{ name: "#onebots" }],
    } as const;
}

describe("Ircv3Client", () => {
    it("negotiates CAP 302, tracks ISUPPORT, joins channels and answers PING", async () => {
        const socket = new FakeSocket();
        const client = new Ircv3Client(config(), {
            connect: async () => socket as unknown as Ircv3Socket,
        });
        const started = client.start();
        await vi.waitFor(() => expect(socket.writes).toContain("CAP LS 302\r\n"));
        socket.line(
            ":irc.example.com CAP * LS :message-tags server-time batch labeled-response echo-message",
        );
        await vi.waitFor(() =>
            expect(socket.writes.some(line => line.startsWith("CAP REQ"))).toBe(true),
        );
        socket.line(
            ":irc.example.com CAP * ACK :message-tags server-time batch labeled-response echo-message",
        );
        await vi.waitFor(() => expect(socket.writes).toContain("CAP END\r\n"));
        socket.line(":irc.example.com 001 actual-nick :Welcome");
        socket.line(
            ":irc.example.com 005 actual-nick CASEMAPPING=rfc1459 CHANTYPES=#& MONITOR=100 :supported",
        );
        await started;
        expect(client.snapshot.nickname).toBe("actual-nick");
        await vi.waitFor(() => expect(client.snapshot.isupport.MONITOR).toBe("100"));
        expect(socket.writes).toContain("JOIN #onebots\r\n");
        socket.line("PING :opaque token");
        await vi.waitFor(() => expect(socket.writes).toContain("PONG :opaque token\r\n"));
        await client.stop();
        expect(socket.ended).toBe(true);
    });

    it("makes concurrent start callers wait for the same registration", async () => {
        const socket = new FakeSocket();
        const client = new Ircv3Client(config(), {
            connect: async () => socket as unknown as Ircv3Socket,
        });
        const first = client.start();
        let secondResolved = false;
        const second = client.start().then(() => {
            secondResolved = true;
        });
        await vi.waitFor(() => expect(socket.writes).toContain("CAP LS 302\r\n"));
        expect(secondResolved).toBe(false);
        socket.line(":server CAP * LS :");
        socket.line(":server 001 onebots :Welcome");
        await Promise.all([first, second]);
        expect(secondResolved).toBe(true);
        await client.stop();
    });

    it("performs SASL PLAIN before CAP END and does not expose credentials as events", async () => {
        const socket = new FakeSocket();
        const client = new Ircv3Client(
            {
                ...config(),
                channels: [],
                sasl_mechanism: "PLAIN",
                sasl_username: "bot-account",
                sasl_password: "secret",
                sasl_required: true,
                event_commands: ["PRIVMSG"],
            },
            { connect: async () => socket as unknown as Ircv3Socket },
        );
        const deliveries: Ircv3Delivery[] = [];
        client.on("event", delivery => deliveries.push(delivery));
        const started = client.start();
        await vi.waitFor(() => expect(socket.writes).toContain("CAP LS 302\r\n"));
        socket.line(":server CAP * LS :sasl=PLAIN message-tags");
        await vi.waitFor(() =>
            expect(socket.writes.some(line => line.includes("sasl"))).toBe(true),
        );
        socket.line(":server CAP * ACK :sasl message-tags");
        await vi.waitFor(() => expect(socket.writes).toContain("AUTHENTICATE PLAIN\r\n"));
        socket.line("AUTHENTICATE +");
        const expected = Buffer.from("\0bot-account\0secret").toString("base64");
        await vi.waitFor(() => expect(socket.writes).toContain(`AUTHENTICATE ${expected}\r\n`));
        socket.line(":server 903 onebots :SASL success");
        socket.line(":server 001 onebots :Welcome");
        await started;
        expect(deliveries).toEqual([]);
        await client.stop();
    });

    it("adopts an existing registered socket and correlates labeled echo receipts", async () => {
        const socket = new FakeSocket();
        const client = new Ircv3Client({ ...config(), receive_mode: "manual" });
        await client.start();
        await client.acceptSocket(socket as unknown as Ircv3Socket, {
            registered: true,
            nickname: "onebots",
            enabledCapabilities: {
                "message-tags": null,
                "labeled-response": null,
                "echo-message": null,
            },
            isupport: { CHANTYPES: "#" },
        });
        const sent = client.sendMessageWithReceipt("#onebots", "hello");
        await vi.waitFor(() => expect(socket.writes.length).toBe(1));
        const outbound = parseIrcv3Message(socket.writes[0]);
        const label = outbound.tags.label;
        expect(typeof label).toBe("string");
        socket.line(`@label=${label};msgid=server-id :onebots!bot@example PRIVMSG #onebots :hello`);
        await expect(sent).resolves.toBe("server-id");
        await client.stop();
        expect(socket.ended).toBe(false);
        expect(socket.listenerCount("data")).toBe(0);
        expect(socket.listenerCount("message")).toBe(0);
        expect(socket.listenerCount("close")).toBe(0);
        expect(socket.listenerCount("error")).toBe(0);
    });

    it("rejects malformed host socket contracts before changing lifecycle state", async () => {
        const client = new Ircv3Client({ ...config(), receive_mode: "manual" });
        await expect(client.acceptSocket({} as never)).rejects.toMatchObject({
            code: "IRCV3_INVALID_SOCKET",
        });
        expect(client.isStarted).toBe(false);
    });

    it("uses one ingress while preserving legitimate retransmissions with the same msgid", async () => {
        const client = new Ircv3Client({
            ...config(),
            receive_mode: "manual",
            event_commands: ["PRIVMSG"],
        });
        const deliveries: Ircv3Delivery[] = [];
        client.on("event", delivery => deliveries.push(delivery));
        await client.start();
        const first = await client.ingest("@msgid=same :alice!u@h PRIVMSG #onebots :hello");
        const retransmission = await client.ingest(
            parseIrcv3Message("@msgid=same :alice!u@h PRIVMSG #onebots :hello"),
        );
        const filtered = await client.ingest(":alice!u@h JOIN #onebots");
        expect(first).toMatchObject({ accepted: true, filtered: false });
        expect(retransmission).toMatchObject({ accepted: true, filtered: false });
        expect(filtered).toMatchObject({ accepted: false, filtered: true });
        expect(deliveries).toHaveLength(2);
    });

    it("collects CHATHISTORY batches and marks replayed deliveries", async () => {
        const socket = new FakeSocket();
        const client = new Ircv3Client({ ...config(), receive_mode: "manual" });
        const deliveries: Ircv3Delivery[] = [];
        client.on("event", delivery => deliveries.push(delivery));
        await client.start();
        await client.acceptSocket(socket as unknown as Ircv3Socket, {
            registered: true,
            isupport: { CHATHISTORY: "100", CHANTYPES: "#" },
            enabledCapabilities: {
                "draft/chathistory": null,
                batch: null,
                "message-tags": null,
                "server-time": null,
            },
        });
        const history = client.history("#onebots", 500);
        await vi.waitFor(() =>
            expect(socket.writes).toContain("CHATHISTORY LATEST #onebots * 100\r\n"),
        );
        socket.line(":server BATCH +history chathistory #onebots");
        socket.line("@batch=history;msgid=old :alice!u@h PRIVMSG #onebots :from history");
        socket.line(":server BATCH -history");
        const messages = await history;
        expect(messages.map(message => message.command)).toEqual(["BATCH", "PRIVMSG", "BATCH"]);
        expect(deliveries.find(delivery => delivery.message.command === "PRIVMSG")?.replayed).toBe(
            true,
        );
    });

    it("cancels a pending request with AbortSignal without poisoning the next request", async () => {
        const socket = new FakeSocket();
        const client = new Ircv3Client({ ...config(), receive_mode: "manual" });
        await client.acceptSocket(socket as unknown as Ircv3Socket, { registered: true });
        const controller = new AbortController();
        const aborted = client.request("WHOIS", ["alice"], {
            endCommands: ["318"],
            signal: controller.signal,
        });
        await vi.waitFor(() => expect(socket.writes).toContain("WHOIS alice\r\n"));
        controller.abort();
        await expect(aborted).rejects.toMatchObject({ code: "IRCV3_ABORTED" });

        const next = client.request("NAMES", ["#onebots"], { endCommands: ["366"] });
        socket.line(":server 366 onebots #onebots :End of NAMES");
        await expect(next).resolves.toHaveLength(1);
        await client.stop();
    });

    it("returns one structured rejection when a request cannot be written", async () => {
        const client = new Ircv3Client({ ...config(), receive_mode: "manual" });
        await client.start();
        await expect(
            client.request("WHOIS", ["alice"], { endCommands: ["318"] }),
        ).rejects.toMatchObject({ code: "IRCV3_NOT_CONNECTED" });
        await client.stop();
    });

    it("keeps reconnecting after repeated full socket closes", async () => {
        vi.useFakeTimers();
        try {
            const sockets: FakeSocket[] = [];
            const connect = vi.fn(async () => {
                const socket = new FakeSocket();
                sockets.push(socket);
                return socket as unknown as Ircv3Socket;
            });
            const client = new Ircv3Client(
                { ...config(), channels: [], reconnect_initial_delay_ms: 100 },
                { connect, random: () => 0 },
            );
            const started = client.start();
            await flushPromises();
            sockets[0].line(":server CAP * LS :");
            sockets[0].line(":server 001 onebots :Welcome");
            await started;

            for (let index = 0; index < 12; index += 1) {
                sockets[index].emit("close");
                await flushPromises();
                expect(sockets[index].listenerCount("close")).toBe(0);
                await vi.advanceTimersByTimeAsync(75);
                await flushPromises();
                expect(sockets).toHaveLength(index + 2);
                sockets[index + 1].line(":server CAP * LS :");
                sockets[index + 1].line(":server 001 onebots :Welcome");
                await flushPromises();
            }
            expect(connect).toHaveBeenCalledTimes(13);
            expect(client.isRegistered).toBe(true);
            await client.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});

async function flushPromises(): Promise<void> {
    for (let index = 0; index < 12; index += 1) await Promise.resolve();
}
