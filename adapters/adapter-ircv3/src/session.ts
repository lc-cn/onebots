import { formatIrcv3Message } from "./codec.js";
import type { NormalizedIrcv3Config } from "./configuration.js";
import { Ircv3Error } from "./errors.js";
import type {
    Ircv3Delivery,
    Ircv3Message,
    Ircv3SessionSnapshot,
    Ircv3SocketAttachOptions,
} from "./types.js";

interface ActiveBatch {
    type?: string;
    params: readonly string[];
}

export interface Ircv3SessionHooks {
    send(line: string): void;
    onRegistered(): void | Promise<void>;
    failRegistration(error: Error): void;
}

/** IRC 注册协商与连接内状态；Client 只负责生命周期、I/O 和公开动作。 */
export class Ircv3Session {
    private readonly availableCapabilities = new Map<string, string | null>();
    private readonly enabledCapabilities = new Set<string>();
    private readonly isupport = new Map<string, string | null>();
    private readonly joinedChannels = new Set<string>();
    private readonly batches = new Map<string, ActiveBatch>();
    private capLsFragments: string[] = [];
    private pendingCapabilities = new Set<string>();
    private sequence = 0;
    private capEndSent = false;
    private saslStarted = false;
    private saslFinished = false;
    private currentNickname: string;
    private currentAccount?: string;
    private currentServer?: string;
    private operator = false;

    constructor(private readonly config: NormalizedIrcv3Config) {
        this.currentNickname = config.nickname;
    }

    snapshot(connected: boolean, registered: boolean): Ircv3SessionSnapshot {
        return Object.freeze({
            connected,
            registered,
            nickname: this.currentNickname,
            account: this.currentAccount,
            server: this.currentServer,
            availableCapabilities: Object.freeze(Object.fromEntries(this.availableCapabilities)),
            enabledCapabilities: Object.freeze([...this.enabledCapabilities].sort()),
            isupport: Object.freeze(Object.fromEntries(this.isupport)),
            joinedChannels: Object.freeze([...this.joinedChannels]),
            operator: this.operator,
        });
    }

    supportsCapability(name: string): boolean {
        return this.enabledCapabilities.has(name);
    }

    supportsFeature(name: string): boolean {
        return this.isupport.has(name.toUpperCase());
    }

    supportsHistory(): boolean {
        return (
            this.supportsCapability("draft/chathistory") &&
            this.supportsCapability("batch") &&
            this.supportsCapability("message-tags") &&
            this.supportsCapability("server-time") &&
            this.supportsFeature("CHATHISTORY")
        );
    }

    historyParams(target: string, limit: number, beforeMessageId?: string): string[] {
        if (!this.supportsHistory()) {
            throw new Ircv3Error(
                "历史查询需要 draft/chathistory、batch、message-tags、server-time 与 CHATHISTORY ISUPPORT",
                { code: "IRCV3_CHATHISTORY_UNAVAILABLE" },
            );
        }
        if (!Number.isSafeInteger(limit) || limit < 1) {
            throw Ircv3Error.invalid("CHATHISTORY limit 必须是正安全整数");
        }
        const referenceTypes = this.isupport.get("MSGREFTYPES")?.split(",") || [];
        if (beforeMessageId && referenceTypes.length > 0 && !referenceTypes.includes("msgid")) {
            throw new Ircv3Error("服务器未宣告 msgid CHATHISTORY reference", {
                code: "IRCV3_CHATHISTORY_MSGID_UNAVAILABLE",
            });
        }
        const advertised = Number(this.isupport.get("CHATHISTORY") || 0);
        const bounded = advertised > 0 ? Math.min(limit, advertised) : limit;
        return beforeMessageId
            ? ["BEFORE", target, `msgid=${beforeMessageId}`, String(bounded)]
            : ["LATEST", target, "*", String(bounded)];
    }

    identifiersEqual(left: string | undefined, right: string): boolean {
        if (!left) return false;
        const casemapping = this.isupport.get("CASEMAPPING") || "rfc1459";
        return foldCase(left, casemapping) === foldCase(right, casemapping);
    }

    clientTagAllowed(tag: string): boolean {
        const deny = this.isupport.get("CLIENTTAGDENY");
        if (!deny) return true;
        const values = deny.split(",");
        return values[0] === "*" ? values.includes(`-${tag}`) : !values.includes(tag);
    }

    adopt(options: Ircv3SocketAttachOptions): void {
        this.currentNickname = options.nickname || this.config.nickname;
        this.currentAccount = options.account;
        this.currentServer = options.server;
        for (const [name, value] of Object.entries(options.enabledCapabilities || {})) {
            this.availableCapabilities.set(name, value);
            this.enabledCapabilities.add(name);
        }
        for (const [name, value] of Object.entries(options.isupport || {})) {
            this.isupport.set(name.toUpperCase(), value);
        }
    }

    reset(): void {
        this.availableCapabilities.clear();
        this.enabledCapabilities.clear();
        this.isupport.clear();
        this.joinedChannels.clear();
        this.batches.clear();
        this.capLsFragments = [];
        this.pendingCapabilities.clear();
        this.capEndSent = false;
        this.saslStarted = false;
        this.saslFinished = false;
        this.currentNickname = this.config.nickname;
        this.currentAccount = undefined;
        this.currentServer = undefined;
        this.operator = false;
    }

    begin(send: (line: string) => void): void {
        this.capEndSent = false;
        this.saslStarted = false;
        this.saslFinished = false;
        this.capLsFragments = [];
        this.pendingCapabilities.clear();
        if (this.config.server_password) {
            send(formatIrcv3Message("PASS", [this.config.server_password]));
        }
        send(formatIrcv3Message("CAP", ["LS", "302"]));
        send(formatIrcv3Message("NICK", [this.config.nickname]));
        send(formatIrcv3Message("USER", [this.config.username, "0", "*", this.config.realname]));
    }

    async consume(message: Ircv3Message, hooks: Ircv3SessionHooks): Promise<void> {
        if (message.command === "PING") {
            if (message.params[0]) hooks.send(formatIrcv3Message("PONG", [message.params[0]]));
            return;
        }
        if (message.command === "CAP") {
            this.consumeCapability(message, hooks);
            return;
        }
        if (message.command === "AUTHENTICATE" && message.params[0] === "+" && this.saslStarted) {
            this.sendSaslPayload(hooks.send);
            return;
        }
        if (message.command === "900") this.currentAccount = message.params[2];
        if (message.command === "903") {
            this.saslFinished = true;
            if (this.pendingCapabilities.size === 0) {
                this.finishCapabilityNegotiation(hooks.send);
            }
            return;
        }
        if (["904", "905", "906", "907"].includes(message.command)) {
            this.handleSaslFailure(message, hooks);
            return;
        }
        if (message.command === "001") {
            this.currentNickname = message.params[0] || this.currentNickname;
            this.currentServer = message.source?.server || message.source?.raw;
            await hooks.onRegistered();
            return;
        }
        if (message.command === "005") this.consumeIsupport(message);
        if (message.command === "381") this.operator = true;
        if (
            message.command === "NICK" &&
            this.identifiersEqual(message.source?.nick, this.currentNickname)
        ) {
            this.currentNickname = message.params[0] || this.currentNickname;
        }
        this.trackChannelState(message);
        this.trackBatch(message);
    }

    createDelivery(message: Ircv3Message, generation: number, now: number): Ircv3Delivery {
        const batchId = typeof message.tags.batch === "string" ? message.tags.batch : undefined;
        const batch = batchId ? this.batches.get(batchId) : undefined;
        // msgid 在 CHATHISTORY 等重传中允许复用，不能作为投递主键。
        const id = `${generation}:${++this.sequence}`;
        return {
            id,
            message,
            receivedAt: parseServerTime(message.tags.time) ?? now,
            replayed: batch?.type === "chathistory" || batch?.type === "draft/chathistory",
            batch:
                batchId && batch
                    ? { id: batchId, type: batch.type, params: batch.params }
                    : undefined,
        };
    }

    private consumeCapability(message: Ircv3Message, hooks: Ircv3SessionHooks): void {
        const subcommand = message.params[1]?.toUpperCase();
        const values = message.params.at(-1)?.split(" ").filter(Boolean) || [];
        if (subcommand === "LS") {
            this.capLsFragments.push(...values);
            if (message.params.at(-2) === "*") return;
            this.availableCapabilities.clear();
            this.enabledCapabilities.add("cap-notify");
            for (const item of this.capLsFragments) {
                const [name, value] = splitToken(item);
                this.availableCapabilities.set(name, value);
            }
            this.capLsFragments = [];
            const requested = this.config.requested_capabilities.filter(capability =>
                this.availableCapabilities.has(capability),
            );
            if (
                this.config.sasl_mechanism &&
                this.availableCapabilities.has("sasl") &&
                !requested.includes("sasl")
            ) {
                requested.push("sasl");
            }
            if (this.config.sasl_required && !this.availableCapabilities.has("sasl")) {
                hooks.failRegistration(
                    new Ircv3Error("服务器未提供必需的 SASL capability", {
                        code: "IRCV3_SASL_UNAVAILABLE",
                    }),
                );
                return;
            }
            this.pendingCapabilities = new Set(requested);
            if (requested.length) this.sendCapabilityRequests(requested, hooks.send);
            else this.finishCapabilityNegotiation(hooks.send);
            return;
        }
        if (subcommand === "ACK") {
            for (const token of values) {
                const disabled = token.startsWith("-");
                const name = (disabled ? token.slice(1) : token).split("=", 1)[0];
                if (disabled) this.enabledCapabilities.delete(name);
                else this.enabledCapabilities.add(name);
                this.pendingCapabilities.delete(name);
            }
            if (
                this.enabledCapabilities.has("sasl") &&
                this.config.sasl_mechanism &&
                !this.saslStarted
            ) {
                this.saslStarted = true;
                hooks.send(formatIrcv3Message("AUTHENTICATE", [this.config.sasl_mechanism]));
            } else if (
                this.pendingCapabilities.size === 0 &&
                (!this.saslStarted || this.saslFinished)
            ) {
                this.finishCapabilityNegotiation(hooks.send);
            }
            return;
        }
        if (subcommand === "NAK") {
            if (
                this.config.sasl_required &&
                values.some(value => value.replace(/^-/, "").startsWith("sasl"))
            ) {
                hooks.failRegistration(
                    new Ircv3Error("服务器拒绝必需的 SASL capability", {
                        code: "IRCV3_SASL_REJECTED",
                    }),
                );
                return;
            }
            for (const token of values) {
                this.pendingCapabilities.delete(token.replace(/^-/, "").split("=", 1)[0]);
            }
            if (this.pendingCapabilities.size === 0 && !this.saslStarted) {
                this.finishCapabilityNegotiation(hooks.send);
            }
            return;
        }
        if (subcommand === "NEW") {
            const request: string[] = [];
            for (const item of values) {
                const [name, value] = splitToken(item);
                this.availableCapabilities.set(name, value);
                if (this.config.requested_capabilities.includes(name)) request.push(name);
            }
            if (request.length) this.sendCapabilityRequests(request, hooks.send);
            return;
        }
        if (subcommand === "DEL") {
            for (const item of values) {
                const name = item.split("=", 1)[0];
                this.availableCapabilities.delete(name);
                this.enabledCapabilities.delete(name);
            }
        }
    }

    private sendSaslPayload(send: (line: string) => void): void {
        const raw =
            this.config.sasl_mechanism === "PLAIN"
                ? `${this.config.sasl_authzid || ""}\0${this.config.sasl_username || ""}\0${this.config.sasl_password || ""}`
                : this.config.sasl_authzid || "";
        const payload = Buffer.from(raw, "utf8").toString("base64");
        if (!payload) {
            send(formatIrcv3Message("AUTHENTICATE", ["+"]));
            return;
        }
        for (let offset = 0; offset < payload.length; offset += 400) {
            send(formatIrcv3Message("AUTHENTICATE", [payload.slice(offset, offset + 400)]));
        }
        if (payload.length % 400 === 0) send(formatIrcv3Message("AUTHENTICATE", ["+"]));
    }

    private finishCapabilityNegotiation(send: (line: string) => void): void {
        if (this.capEndSent) return;
        this.capEndSent = true;
        send(formatIrcv3Message("CAP", ["END"]));
    }

    private handleSaslFailure(message: Ircv3Message, hooks: Ircv3SessionHooks): void {
        if (this.config.sasl_required) {
            hooks.failRegistration(
                new Ircv3Error(message.params.at(-1) || "SASL 认证失败", {
                    code: `IRCV3_SASL_${message.command}`,
                    status: Number(message.command),
                }),
            );
        } else {
            this.saslFinished = true;
            if (this.pendingCapabilities.size === 0) {
                this.finishCapabilityNegotiation(hooks.send);
            }
        }
    }

    private sendCapabilityRequests(names: readonly string[], send: (line: string) => void): void {
        let chunk: string[] = [];
        for (const name of names) {
            try {
                formatIrcv3Message("CAP", ["REQ", [...chunk, name].join(" ")]);
                chunk.push(name);
            } catch (error) {
                if (chunk.length === 0) throw error;
                send(formatIrcv3Message("CAP", ["REQ", chunk.join(" ")]));
                chunk = [name];
                // 单个 capability 本身仍需满足 512-byte 主报文限制。
                formatIrcv3Message("CAP", ["REQ", name]);
            }
        }
        if (chunk.length) send(formatIrcv3Message("CAP", ["REQ", chunk.join(" ")]));
    }

    private consumeIsupport(message: Ircv3Message): void {
        for (const token of message.params.slice(1, -1)) {
            const removed = token.startsWith("-");
            const [name, value] = splitToken(removed ? token.slice(1) : token);
            if (removed) this.isupport.delete(name.toUpperCase());
            else this.isupport.set(name.toUpperCase(), value);
        }
    }

    private trackChannelState(message: Ircv3Message): void {
        const nick = message.source?.nick;
        if (
            message.command === "JOIN" &&
            this.identifiersEqual(nick, this.currentNickname) &&
            message.params[0]
        ) {
            this.joinedChannels.add(message.params[0]);
        }
        if (
            message.command === "PART" &&
            this.identifiersEqual(nick, this.currentNickname) &&
            message.params[0]
        ) {
            this.joinedChannels.delete(message.params[0]);
        }
        if (
            message.command === "KICK" &&
            this.identifiersEqual(message.params[1], this.currentNickname) &&
            message.params[0]
        ) {
            this.joinedChannels.delete(message.params[0]);
        }
    }

    private trackBatch(message: Ircv3Message): void {
        if (message.command !== "BATCH") return;
        const reference = message.params[0];
        if (!reference || !/^[+-][A-Za-z0-9-]+$/u.test(reference)) return;
        const id = reference.slice(1);
        if (reference.startsWith("+")) {
            this.batches.set(id, { type: message.params[1], params: message.params.slice(2) });
        } else this.batches.delete(id);
    }
}

function splitToken(token: string): [string, string | null] {
    const separator = token.indexOf("=");
    return separator < 0 ? [token, null] : [token.slice(0, separator), token.slice(separator + 1)];
}

function parseServerTime(value: string | null | undefined): number | undefined {
    if (!value) return undefined;
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : undefined;
}

function foldCase(value: string, mapping: string): string {
    const lower = value.toLowerCase();
    if (mapping === "ascii") return lower;
    const strict = lower.replace(
        /[\[\]\\]/gu,
        character => ({ "[": "{", "]": "}", "\\": "|" })[character] || character,
    );
    return mapping === "strict-rfc1459" ? strict : strict.replace(/\^/gu, "~");
}
