import { WechatApiError } from "./errors.js";
import type { WechatIncomingMessage, WechatOutboundMessage } from "./types.js";

const NUMBER_FIELDS = new Set([
    "CreateTime",
    "Location_X",
    "Location_Y",
    "Scale",
    "Latitude",
    "Longitude",
    "Precision",
]);

/** 解析微信扁平 XML，拒绝 DTD/实体并保留未知顶层字段。 */
export function parseWechatXml(xml: string): Record<string, unknown> {
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) {
        throw new WechatApiError("微信公众号 XML 不允许 DTD 或实体声明", {
            code: "WECHAT_UNSAFE_XML",
        });
    }
    const root = xml.match(/^\s*<xml>([\s\S]*)<\/xml>\s*$/iu)?.[1];
    if (root === undefined) return invalidXml();
    const result: Record<string, unknown> = {};
    const pattern = /<([A-Za-z_][\w.-]*)>(?:<!\[CDATA\[([\s\S]*?)\]\]>|([^<]*))<\/\1>/gu;
    for (const match of root.matchAll(pattern)) {
        const key = match[1];
        if (!key) continue;
        const value = match[2] ?? decodeEntities((match[3] || "").trim());
        const number = NUMBER_FIELDS.has(key) ? Number(value) : Number.NaN;
        result[key] = Number.isFinite(number) ? number : value;
    }
    return result;
}

export function parseIncomingMessage(xml: string): WechatIncomingMessage {
    const value = parseWechatXml(xml);
    if (
        typeof value.ToUserName !== "string" ||
        typeof value.FromUserName !== "string" ||
        typeof value.CreateTime !== "number" ||
        typeof value.MsgType !== "string"
    ) {
        return invalidXml();
    }
    return value as WechatIncomingMessage;
}

export function buildPassiveReply(
    incoming: WechatIncomingMessage,
    message: WechatOutboundMessage,
): string {
    const content = passiveContent(message);
    return `<xml><ToUserName>${cdata(incoming.FromUserName)}</ToUserName><FromUserName>${cdata(incoming.ToUserName)}</FromUserName><CreateTime>${Math.floor(Date.now() / 1000)}</CreateTime><MsgType>${cdata(message.msgtype)}</MsgType>${content}</xml>`;
}

export function buildEncryptedReply(
    encrypted: string,
    signature: string,
    timestamp: string,
    nonce: string,
): string {
    return `<xml><Encrypt>${cdata(encrypted)}</Encrypt><MsgSignature>${cdata(signature)}</MsgSignature><TimeStamp>${escapeXml(timestamp)}</TimeStamp><Nonce>${cdata(nonce)}</Nonce></xml>`;
}

function passiveContent(message: WechatOutboundMessage): string {
    if (message.msgtype === "text" && message.text) {
        return `<Content>${cdata(message.text.content)}</Content>`;
    }
    if (["image", "voice"].includes(message.msgtype)) {
        const media = message[message.msgtype] as { media_id?: unknown } | undefined;
        return `<${title(message.msgtype)}><MediaId>${cdata(requireString(media?.media_id, "media_id"))}</MediaId></${title(message.msgtype)}>`;
    }
    if (message.msgtype === "video" && message.video) {
        return `<Video><MediaId>${cdata(message.video.media_id)}</MediaId><Title>${cdata(message.video.title || "")}</Title><Description>${cdata(message.video.description || "")}</Description></Video>`;
    }
    if (message.msgtype === "news" && message.news) {
        if (message.news.articles.length > 8) {
            throw new WechatApiError("微信公众号被动图文回复最多 8 篇", {
                code: "WECHAT_TOO_MANY_ARTICLES",
            });
        }
        const articles = message.news.articles
            .map(
                article =>
                    `<item><Title>${cdata(article.title)}</Title><Description>${cdata(article.description || "")}</Description><PicUrl>${cdata(article.picurl || "")}</PicUrl><Url>${cdata(article.url || "")}</Url></item>`,
            )
            .join("");
        return `<ArticleCount>${message.news.articles.length}</ArticleCount><Articles>${articles}</Articles>`;
    }
    throw new WechatApiError(`微信公众号不支持 ${message.msgtype} 被动回复`, {
        code: "WECHAT_UNSUPPORTED_PASSIVE_MESSAGE",
    });
}

function cdata(value: string): string {
    return `<![CDATA[${value.replaceAll("]]>", "]]]]><![CDATA[>")}]]>`;
}

function escapeXml(value: string): string {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&apos;");
}

function decodeEntities(value: string): string {
    return value
        .replaceAll("&lt;", "<")
        .replaceAll("&gt;", ">")
        .replaceAll("&quot;", '"')
        .replaceAll("&apos;", "'")
        .replaceAll("&amp;", "&");
}

function requireString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value) {
        throw new WechatApiError(`微信公众号消息缺少 ${name}`, {
            code: "WECHAT_INVALID_MESSAGE",
        });
    }
    return value;
}

function title(value: string): string {
    return value.charAt(0).toUpperCase() + value.slice(1);
}

function invalidXml(): never {
    throw new WechatApiError("微信公众号 XML 结构无效", {
        code: "WECHAT_INVALID_XML",
        status: 400,
    });
}
