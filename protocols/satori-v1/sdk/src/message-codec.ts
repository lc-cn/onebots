import { Message } from "imhelper";
import type { SatoriElement } from "./types.js";
import { isRecord, malformed } from "./protocol-data.js";

const SATORI_CHILDREN_KEY = "$children";

function decodeElement(value: unknown, operation: string): Message.Segment {
    if (typeof value === "string") return { type: "text", data: { text: value } };
    if (!isRecord(value) || typeof value.type !== "string") return malformed(operation, value);
    if (value.attrs !== undefined && !isRecord(value.attrs)) return malformed(operation, value);
    if (value.children !== undefined && !Array.isArray(value.children)) {
        return malformed(operation, value);
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

/** 将 Satori Element 数组投影为协议无关消息段，并拒绝静默丢失非法元素。 */
export function decodeSatoriContent(value: unknown): Message.Content {
    if (typeof value === "string") return value;
    if (!Array.isArray(value)) return malformed("event.message.content", value);
    return value.map((element, index) => decodeElement(element, `event.message.content[${index}]`));
}

/** 将 imhelper 消息段编译成 Satori 原生 Element；文本快捷形式保持字符串。 */
export function encodeSatoriContent(content: Message.Content): string | SatoriElement[] {
    if (typeof content === "string") return content;
    return Message.toSegments(content).map(encodeElement);
}
