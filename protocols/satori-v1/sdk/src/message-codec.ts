import { Message } from "imhelper";
import type { SatoriElement, SatoriEmojiAttrs } from "./types.js";
import { isRecord, malformed } from "./protocol-data.js";

const SATORI_CHILDREN_KEY = "$children";
const EMOJI_MARKUP =
    /<emoji\b((?:"[^"]*"|'[^']*'|[^>])*?)\/>|<emoji\b((?:"[^"]*"|'[^']*'|[^>])*?)><\/emoji>/gi;

function assertEmojiAttrs(attrs: { id?: unknown; name?: unknown }, operation: string): void {
    if (attrs.id !== undefined && typeof attrs.id !== "string") {
        return malformed(`${operation}.id`, attrs);
    }
    if (attrs.name !== undefined && typeof attrs.name !== "string") {
        return malformed(`${operation}.name`, attrs);
    }
}

function decodeElement(value: unknown, operation: string): Message.Segment {
    if (typeof value === "string") return { type: "text", data: { text: value } };
    if (!isRecord(value) || typeof value.type !== "string") return malformed(operation, value);
    if (value.attrs !== undefined && !isRecord(value.attrs)) return malformed(operation, value);
    if (value.children !== undefined && !Array.isArray(value.children)) {
        return malformed(operation, value);
    }
    if (value.type === "emoji" && isRecord(value.attrs)) {
        assertEmojiAttrs(value.attrs, operation);
    }

    return {
        type: value.type,
        data: {
            ...(value.attrs ?? {}),
            ...(value.children
                ? {
                      [SATORI_CHILDREN_KEY]: value.children.map((child, index) =>
                          decodeElement(child, `${operation}.children[${index}]`),
                      ),
                  }
                : {}),
        },
    };
}

function encodeElement(segment: Message.Segment): SatoriElement {
    if (segment.type === "emoji") assertEmojiAttrs(segment.data, "message.emoji");
    const { [SATORI_CHILDREN_KEY]: children, ...attrs } = segment.data;
    if (children !== undefined && !Array.isArray(children)) {
        return malformed(`message.${SATORI_CHILDREN_KEY}`, children);
    }

    return {
        type: segment.type,
        ...(Object.keys(attrs).length > 0 ? { attrs } : {}),
        ...(children
            ? {
                  children: children.map((child, index) => {
                      if (
                          !isRecord(child) ||
                          typeof child.type !== "string" ||
                          !isRecord(child.data)
                      ) {
                          return malformed(`message.${SATORI_CHILDREN_KEY}[${index}]`, child);
                      }
                      return encodeElement({ type: child.type, data: child.data });
                  }),
              }
            : {}),
    };
}

function parseEmojiAttributes(source: string): Record<string, string> | undefined {
    const attrs: Record<string, string> = {};
    const pattern = /([A-Za-z_][\w:.-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let last = 0;
    for (const match of source.matchAll(pattern)) {
        const index = match.index ?? 0;
        if (source.slice(last, index).trim() !== "") return undefined;
        const key = match[1];
        if (!key) return undefined;
        attrs[key] = unescapeAttribute(match[2] ?? match[3] ?? match[4] ?? "");
        last = index + match[0].length;
    }
    if (source.slice(last).trim() !== "") return undefined;
    return attrs;
}

function escapeAttribute(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll('"', "&quot;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;");
}

function unescapeAttribute(value: string): string {
    return value
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&amp;", "&");
}

/** 构造官方 `<emoji>` 元素对象。https://satori.chat/zh-CN/protocol/elements.html */
export function createSatoriEmojiElement(attrs: SatoriEmojiAttrs = {}): SatoriElement {
    assertEmojiAttrs(attrs, "message.emoji");
    const data: Record<string, string> = {};
    if (attrs.id !== undefined) data.id = attrs.id;
    if (attrs.name !== undefined) data.name = attrs.name;
    return {
        type: "emoji",
        ...(Object.keys(data).length > 0 ? { attrs: data } : {}),
    };
}

/** 将表情写成 message.create 可直接携带的标记字符串。 */
export function renderSatoriEmoji(attrs: SatoriEmojiAttrs = {}): string {
    const element = createSatoriEmojiElement(attrs);
    const parts = Object.entries(element.attrs ?? {}).map(
        ([key, value]) => `${key}="${escapeAttribute(String(value))}"`,
    );
    return `<emoji${parts.length > 0 ? ` ${parts.join(" ")}` : ""}/>`;
}

/** 从文本内容中拆出 `<emoji>`，其余文本保持原样。没有表情标记时仍返回字符串。 */
export function decodeSatoriEmojiMarkup(content: string): Message.Content {
    const segments: Message.Segment[] = [];
    let cursor = 0;
    let found = false;
    for (const match of content.matchAll(EMOJI_MARKUP)) {
        const attrs = parseEmojiAttributes(match[1] ?? match[2] ?? "");
        if (!attrs) continue;
        const index = match.index ?? 0;
        if (index < cursor) continue;
        found = true;
        if (index > cursor) {
            segments.push({ type: "text", data: { text: content.slice(cursor, index) } });
        }
        segments.push({ type: "emoji", data: attrs });
        cursor = index + match[0].length;
    }
    if (!found) return content;
    if (cursor < content.length) {
        segments.push({ type: "text", data: { text: content.slice(cursor) } });
    }
    return segments;
}

/** 将 Satori Element 数组投影为协议无关消息段，并拒绝静默丢失非法元素。 */
export function decodeSatoriContent(value: unknown): Message.Content {
    if (typeof value === "string") return decodeSatoriEmojiMarkup(value);
    if (!Array.isArray(value)) return malformed("event.message.content", value);
    return value.map((element, index) => decodeElement(element, `event.message.content[${index}]`));
}

/** 将 imhelper 消息段编译成 Satori 原生 Element；文本快捷形式保持字符串。 */
export function encodeSatoriContent(content: Message.Content): string | SatoriElement[] {
    if (typeof content === "string") return content;
    return Message.toSegments(content).map(encodeElement);
}
