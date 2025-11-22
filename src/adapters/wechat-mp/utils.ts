import { CommonEvent } from "@/common-types";

/**
 * Utility functions for WeChat Official Account adapter
 */

/**
 * Convert WeChat message type to common message type
 */
export function convertMessageType(wechatType: string): CommonEvent.MessageScene {
    // WeChat Official Account only supports private messages
    return "private";
}

/**
 * Parse WeChat message content to segments
 */
export function parseMessageContent(wechatMsg: any): CommonEvent.Segment[] {
    const segments: CommonEvent.Segment[] = [];

    switch (wechatMsg.MsgType) {
        case "text":
            segments.push({
                type: "text",
                data: { text: wechatMsg.Content || "" },
            });
            break;
        case "image":
            segments.push({
                type: "image",
                data: {
                    url: wechatMsg.PicUrl,
                    media_id: wechatMsg.MediaId,
                },
            });
            break;
        case "voice":
            segments.push({
                type: "voice",
                data: {
                    media_id: wechatMsg.MediaId,
                    format: wechatMsg.Format,
                    recognition: wechatMsg.Recognition,
                },
            });
            break;
        case "video":
        case "shortvideo":
            segments.push({
                type: "video",
                data: {
                    media_id: wechatMsg.MediaId,
                    thumb_media_id: wechatMsg.ThumbMediaId,
                },
            });
            break;
        case "location":
            segments.push({
                type: "location",
                data: {
                    latitude: wechatMsg.Location_X,
                    longitude: wechatMsg.Location_Y,
                    scale: wechatMsg.Scale,
                    label: wechatMsg.Label,
                },
            });
            break;
        case "link":
            segments.push({
                type: "link",
                data: {
                    title: wechatMsg.Title,
                    description: wechatMsg.Description,
                    url: wechatMsg.Url,
                },
            });
            break;
    }

    return segments;
}

/**
 * Build WeChat message from segments
 */
export function buildWechatMessage(segments: CommonEvent.Segment[]): {
    msgType: string;
    content: any;
} {
    if (!segments || segments.length === 0) {
        return { msgType: "text", content: "" };
    }

    const firstSegment = segments[0];

    switch (firstSegment.type) {
        case "text":
            return {
                msgType: "text",
                content: segments
                    .filter(seg => seg.type === "text")
                    .map(seg => seg.data.text || "")
                    .join(""),
            };
        case "image":
            return {
                msgType: "image",
                content: {
                    mediaId: firstSegment.data.media_id || firstSegment.data.file,
                },
            };
        case "voice":
            return {
                msgType: "voice",
                content: {
                    mediaId: firstSegment.data.media_id || firstSegment.data.file,
                },
            };
        case "video":
            return {
                msgType: "video",
                content: {
                    mediaId: firstSegment.data.media_id || firstSegment.data.file,
                    thumbMediaId: firstSegment.data.thumb_media_id,
                    title: firstSegment.data.title,
                    description: firstSegment.data.description,
                },
            };
        default:
            return { msgType: "text", content: "[Unsupported message type]" };
    }
}

/**
 * Format error message
 */
export function formatErrorMessage(error: any): string {
    if (error.response?.data?.errmsg) {
        return `WeChat API error: ${error.response.data.errmsg}`;
    }
    return error.message || String(error);
}
