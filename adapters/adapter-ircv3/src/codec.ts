import { StringDecoder } from "node:string_decoder";
import { Ircv3Error } from "./errors.js";
import type { Ircv3Message, Ircv3Prefix } from "./types.js";

export const IRC_MAIN_SECTION_MAX_BYTES = 512;
export const IRC_TAG_SECTION_MAX_BYTES = 8191;
export const IRC_CLIENT_TAG_DATA_MAX_BYTES = 4094;
export const IRC_DEFAULT_MAX_LINE_BYTES = IRC_MAIN_SECTION_MAX_BYTES + IRC_TAG_SECTION_MAX_BYTES;

const COMMAND_PATTERN = /^(?:[A-Za-z]+|\d{3})$/u;
const TAG_KEY_PATTERN = /^\+?(?:(?:[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?)\/)?[A-Za-z0-9-]+$/u;

export function parseIrcv3Message(
    rawInput: string,
    maxBytes = IRC_DEFAULT_MAX_LINE_BYTES,
): Ircv3Message {
    const raw = stripSingleTerminator(rawInput);
    if (!raw) throw Ircv3Error.invalid("IRC message 不能为空", "IRCV3_EMPTY_MESSAGE");
    if (raw.includes("\0") || raw.includes("\r") || raw.includes("\n")) {
        throw Ircv3Error.invalid("IRC message 包含非法控制字符", "IRCV3_INVALID_CONTROL");
    }
    assertLineSize(raw, maxBytes);
    assertSectionSizes(raw);

    let cursor = 0;
    let tags: Readonly<Record<string, string | null>> = Object.freeze({});
    let source: Ircv3Prefix | undefined;
    if (raw.startsWith("@")) {
        const separator = raw.indexOf(" ");
        if (separator < 2)
            throw Ircv3Error.invalid("IRC tags 后缺少 command", "IRCV3_INVALID_TAGS");
        tags = Object.freeze(parseTags(raw.slice(1, separator)));
        cursor = skipSpaces(raw, separator);
    }
    if (raw[cursor] === ":") {
        const separator = raw.indexOf(" ", cursor);
        if (separator < 0)
            throw Ircv3Error.invalid("IRC source 后缺少 command", "IRCV3_INVALID_SOURCE");
        source = parsePrefix(raw.slice(cursor + 1, separator));
        cursor = skipSpaces(raw, separator);
    }
    const commandEnd = raw.indexOf(" ", cursor);
    const command = (
        commandEnd < 0 ? raw.slice(cursor) : raw.slice(cursor, commandEnd)
    ).toUpperCase();
    if (!COMMAND_PATTERN.test(command)) {
        throw Ircv3Error.invalid(
            `IRC command 无效: ${command || "<empty>"}`,
            "IRCV3_INVALID_COMMAND",
        );
    }
    cursor = commandEnd < 0 ? raw.length : skipSpaces(raw, commandEnd);
    const params = parseParams(raw, cursor);
    if (params.length > 15) {
        throw Ircv3Error.invalid("IRC message 参数超过 15 个", "IRCV3_TOO_MANY_PARAMS");
    }
    return Object.freeze({ raw, tags, source, command, params: Object.freeze(params) });
}

export function coerceIrcv3Message(rawEvent: unknown, maxBytes: number): Ircv3Message {
    if (typeof rawEvent === "string") return parseIrcv3Message(rawEvent, maxBytes);
    if (rawEvent instanceof Uint8Array) {
        return parseIrcv3Message(Buffer.from(rawEvent).toString("utf8"), maxBytes);
    }
    if (
        typeof rawEvent === "object" &&
        rawEvent !== null &&
        "command" in rawEvent &&
        "raw" in rawEvent
    ) {
        return parseIrcv3Message(String(rawEvent.raw), maxBytes);
    }
    throw Ircv3Error.invalid(
        "ingest(rawEvent) 仅接受 IRC 文本行、UTF-8 bytes 或 Ircv3Message",
        "IRCV3_INVALID_INGRESS",
    );
}

export function formatIrcv3Message(
    commandInput: string,
    params: readonly string[] = [],
    tags?: Readonly<Record<string, string | null | undefined>>,
): string {
    const command = commandInput.toUpperCase();
    if (!COMMAND_PATTERN.test(command)) {
        throw Ircv3Error.invalid(`IRC command 无效: ${commandInput}`, "IRCV3_INVALID_COMMAND");
    }
    if (params.length > 15) {
        throw Ircv3Error.invalid("IRC command 参数超过 15 个", "IRCV3_TOO_MANY_PARAMS");
    }
    const encoded = params.map((param, index) => encodeParam(param, index === params.length - 1));
    const tagSection = tags ? formatTags(tags) : "";
    const line = `${tagSection}${command}${encoded.length ? ` ${encoded.join(" ")}` : ""}`;
    assertLineSize(line, IRC_DEFAULT_MAX_LINE_BYTES);
    assertSectionSizes(line, IRC_CLIENT_TAG_DATA_MAX_BYTES + 2);
    return `${line}\r\n`;
}

/** TCP/TLS 字节流严格按 CRLF 拆帧；WebSocket 单帧请直接使用 parseIrcv3Message。 */
export class Ircv3LineDecoder {
    private readonly decoder = new StringDecoder("utf8");
    private buffer = "";

    constructor(private readonly maxBytes = IRC_DEFAULT_MAX_LINE_BYTES) {}

    push(chunk: Uint8Array | string): string[] {
        this.buffer += typeof chunk === "string" ? chunk : this.decoder.write(chunk);
        if (
            Buffer.byteLength(this.buffer, "utf8") > this.maxBytes &&
            !this.buffer.includes("\r\n")
        ) {
            this.buffer = "";
            throw Ircv3Error.invalid("IRC stream 单帧超过上限", "IRCV3_LINE_TOO_LONG");
        }
        const lines: string[] = [];
        while (true) {
            const index = this.buffer.indexOf("\r\n");
            if (index < 0) break;
            const line = this.buffer.slice(0, index);
            this.buffer = this.buffer.slice(index + 2);
            if (!line) continue;
            assertLineSize(line, this.maxBytes);
            lines.push(line);
        }
        if (this.buffer.includes("\n") || this.buffer.includes("\r")) {
            this.buffer = "";
            throw Ircv3Error.invalid("IRC stream 必须使用 CRLF 分帧", "IRCV3_INVALID_TERMINATOR");
        }
        return lines;
    }

    finish(): void {
        const tail = this.buffer + this.decoder.end();
        this.buffer = "";
        if (tail) throw Ircv3Error.invalid("IRC stream 在半帧处结束", "IRCV3_TRUNCATED_FRAME");
    }
}

function parseTags(input: string): Record<string, string | null> {
    // IRCv3 要求客户端把入站 tag key 当作不透明标识，即使它不符合当前 registry
    // 的命名规则也不能拒绝整条消息。null-prototype 同时避免特殊 key 污染对象原型。
    const tags = Object.create(null) as Record<string, string | null>;
    for (const part of input.split(";")) {
        const separator = part.indexOf("=");
        const key = separator < 0 ? part : part.slice(0, separator);
        tags[key] = separator < 0 ? null : unescapeTag(part.slice(separator + 1));
    }
    return tags;
}

function formatTags(tags: Readonly<Record<string, string | null | undefined>>): string {
    const encoded: string[] = [];
    for (const [key, value] of Object.entries(tags)) {
        if (value === undefined) continue;
        if (!TAG_KEY_PATTERN.test(key)) {
            throw Ircv3Error.invalid(`IRC tag key 无效: ${key}`, "IRCV3_INVALID_TAG_KEY");
        }
        encoded.push(value === null ? key : `${key}=${escapeTag(value)}`);
    }
    return encoded.length ? `@${encoded.join(";")} ` : "";
}

function parsePrefix(raw: string): Ircv3Prefix {
    if (!raw || /[\0\r\n ]/u.test(raw)) {
        throw Ircv3Error.invalid("IRC source 无效", "IRCV3_INVALID_SOURCE");
    }
    const bang = raw.indexOf("!");
    const at = raw.indexOf("@", Math.max(0, bang));
    if (bang > 0) {
        return {
            raw,
            nick: raw.slice(0, bang),
            user: at > bang ? raw.slice(bang + 1, at) : raw.slice(bang + 1),
            host: at > bang ? raw.slice(at + 1) : undefined,
        };
    }
    return raw.includes(".") ? { raw, server: raw } : { raw, nick: raw };
}

function parseParams(raw: string, start: number): string[] {
    const params: string[] = [];
    let cursor = start;
    while (cursor < raw.length) {
        if (raw[cursor] === ":") {
            params.push(raw.slice(cursor + 1));
            break;
        }
        const separator = raw.indexOf(" ", cursor);
        if (separator < 0) {
            params.push(raw.slice(cursor));
            break;
        }
        params.push(raw.slice(cursor, separator));
        cursor = skipSpaces(raw, separator);
    }
    return params;
}

function encodeParam(param: string, trailing: boolean): string {
    if (param.includes("\0") || param.includes("\r") || param.includes("\n")) {
        throw Ircv3Error.invalid("IRC command 参数包含非法控制字符", "IRCV3_INVALID_CONTROL");
    }
    if (!trailing && (!param || param.startsWith(":") || param.includes(" "))) {
        throw Ircv3Error.invalid(
            "只有最后一个 IRC 参数可以为空、含空格或以冒号开头",
            "IRCV3_INVALID_PARAM",
        );
    }
    return trailing && (!param || param.startsWith(":") || param.includes(" "))
        ? `:${param}`
        : param;
}

function escapeTag(value: string): string {
    if (/[\0\r\n]/u.test(value)) {
        throw Ircv3Error.invalid("IRC tag value 包含非法控制字符", "IRCV3_INVALID_CONTROL");
    }
    return value.replace(/\\/gu, "\\\\").replace(/;/gu, "\\:").replace(/ /gu, "\\s");
}

function unescapeTag(value: string): string {
    return value.replace(/\\(.)/gu, (_match, escaped: string) => {
        if (escaped === ":") return ";";
        if (escaped === "s") return " ";
        if (escaped === "r") return "\r";
        if (escaped === "n") return "\n";
        return escaped === "\\" ? "\\" : escaped;
    });
}

function stripSingleTerminator(raw: string): string {
    return raw.endsWith("\r\n") ? raw.slice(0, -2) : raw;
}

function skipSpaces(raw: string, start: number): number {
    let cursor = start;
    while (raw[cursor] === " ") cursor += 1;
    return cursor;
}

function assertLineSize(line: string, maxBytes: number): void {
    if (!Number.isSafeInteger(maxBytes) || maxBytes < IRC_MAIN_SECTION_MAX_BYTES) {
        throw Ircv3Error.invalid("maxBytes 必须是不小于 512 的安全整数", "IRCV3_INVALID_LIMIT");
    }
    if (Buffer.byteLength(`${line}\r\n`, "utf8") > maxBytes) {
        throw Ircv3Error.invalid("IRC message 超过配置的字节上限", "IRCV3_LINE_TOO_LONG");
    }
}

function assertSectionSizes(line: string, maxTagSectionBytes = IRC_TAG_SECTION_MAX_BYTES): void {
    const separator = line.startsWith("@") ? line.indexOf(" ") : -1;
    if (
        separator >= 0 &&
        Buffer.byteLength(line.slice(0, separator + 1), "utf8") > maxTagSectionBytes
    ) {
        throw Ircv3Error.invalid(
            `IRC message tags section 超过 ${maxTagSectionBytes} bytes`,
            "IRCV3_TAG_SECTION_TOO_LONG",
        );
    }
    const main = separator >= 0 ? line.slice(separator + 1) : line;
    if (Buffer.byteLength(`${main}\r\n`, "utf8") > IRC_MAIN_SECTION_MAX_BYTES) {
        throw Ircv3Error.invalid("IRC command 主报文超过 512 bytes", "IRCV3_MAIN_SECTION_TOO_LONG");
    }
}
