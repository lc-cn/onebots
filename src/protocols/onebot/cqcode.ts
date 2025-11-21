import { Dict } from "@zhinjs/shared";
import { CommonEvent } from "@/common-types";

/**
 * CQ Code utilities for OneBot V11
 * CQ codes are a special format for representing message segments
 * Format: [CQ:type,param1=value1,param2=value2]
 */
export namespace CQCode {
    /**
     * Escape special characters in CQ code
     */
    export function escape(text: string, insideCQ: boolean = false): string {
        let result = text
            .replace(/&/g, "&amp;")
            .replace(/\[/g, "&#91;")
            .replace(/\]/g, "&#93;");
        
        if (insideCQ) {
            result = result.replace(/,/g, "&#44;");
        }
        
        return result;
    }

    /**
     * Unescape special characters in CQ code
     */
    export function unescape(text: string): string {
        return text
            .replace(/&#91;/g, "[")
            .replace(/&#93;/g, "]")
            .replace(/&#44;/g, ",")
            .replace(/&amp;/g, "&");
    }

    /**
     * Convert segment to CQ code string
     */
    export function encode(segment: CommonEvent.Segment): string {
        if (segment.type === "text") {
            return escape(segment.data.text || "", false);
        }

        const params: string[] = [];
        for (const [key, value] of Object.entries(segment.data)) {
            if (value !== undefined && value !== null) {
                params.push(`${key}=${escape(String(value), true)}`);
            }
        }

        const paramsStr = params.length > 0 ? "," + params.join(",") : "";
        return `[CQ:${segment.type}${paramsStr}]`;
    }

    /**
     * Convert segments array to CQ code string
     */
    export function stringify(segments: CommonEvent.Segment[]): string {
        return segments.map(encode).join("");
    }

    /**
     * Parse CQ code string to segments
     */
    export function parse(message: string): CommonEvent.Segment[] {
        const segments: CommonEvent.Segment[] = [];
        const regex = /\[CQ:([a-zA-Z0-9_-]+)((?:,[a-zA-Z0-9_-]+=[^,\]]*)*)\]/g;
        let lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = regex.exec(message)) !== null) {
            // Add text before CQ code
            if (match.index > lastIndex) {
                const text = message.substring(lastIndex, match.index);
                if (text) {
                    segments.push({
                        type: "text",
                        data: { text: unescape(text) },
                    });
                }
            }

            // Parse CQ code
            const type = match[1];
            const paramsStr = match[2];
            const data: Dict = {};

            if (paramsStr) {
                const params = paramsStr.substring(1).split(",");
                for (const param of params) {
                    const equalIndex = param.indexOf("=");
                    if (equalIndex !== -1) {
                        const key = param.substring(0, equalIndex);
                        const value = param.substring(equalIndex + 1);
                        data[key] = unescape(value);
                    }
                }
            }

            segments.push({ type, data });
            lastIndex = regex.lastIndex;
        }

        // Add remaining text
        if (lastIndex < message.length) {
            const text = message.substring(lastIndex);
            if (text) {
                segments.push({
                    type: "text",
                    data: { text: unescape(text) },
                });
            }
        }

        // If no segments were found, treat entire message as text
        if (segments.length === 0 && message) {
            segments.push({
                type: "text",
                data: { text: message },
            });
        }

        return segments;
    }

    /**
     * Convert segments to plain text (remove all formatting)
     */
    export function toText(segments: CommonEvent.Segment[]): string {
        return segments
            .filter(seg => seg.type === "text")
            .map(seg => seg.data.text || "")
            .join("");
    }

    /**
     * Check if message contains specific segment type
     */
    export function hasSegmentType(segments: CommonEvent.Segment[], type: string): boolean {
        return segments.some(seg => seg.type === type);
    }

    /**
     * Get all segments of a specific type
     */
    export function getSegmentsByType(segments: CommonEvent.Segment[], type: string): CommonEvent.Segment[] {
        return segments.filter(seg => seg.type === type);
    }

    /**
     * Standard CQ code types and their data structure
     */
    export const SegmentTypes = {
        TEXT: "text",
        FACE: "face",
        IMAGE: "image",
        RECORD: "record",
        VIDEO: "video",
        AT: "at",
        RPS: "rps",
        DICE: "dice",
        SHAKE: "shake",
        POKE: "poke",
        ANONYMOUS: "anonymous",
        SHARE: "share",
        CONTACT: "contact",
        LOCATION: "location",
        MUSIC: "music",
        REPLY: "reply",
        FORWARD: "forward",
        NODE: "node",
        XML: "xml",
        JSON: "json",
    } as const;

    /**
     * Create text segment
     */
    export function text(text: string): CommonEvent.Segment {
        return { type: "text", data: { text } };
    }

    /**
     * Create face (emoji) segment
     */
    export function face(id: number | string): CommonEvent.Segment {
        return { type: "face", data: { id: String(id) } };
    }

    /**
     * Create image segment
     */
    export function image(file: string, options?: {
        type?: "flash";
        url?: string;
        cache?: boolean;
        proxy?: boolean;
        timeout?: number;
    }): CommonEvent.Segment {
        return {
            type: "image",
            data: {
                file,
                ...(options?.type && { type: options.type }),
                ...(options?.url && { url: options.url }),
                ...(options?.cache !== undefined && { cache: options.cache ? 1 : 0 }),
                ...(options?.proxy !== undefined && { proxy: options.proxy ? 1 : 0 }),
                ...(options?.timeout && { timeout: options.timeout }),
            },
        };
    }

    /**
     * Create at segment
     */
    export function at(qq: number | string | "all"): CommonEvent.Segment {
        return { type: "at", data: { qq: String(qq) } };
    }

    /**
     * Create reply segment
     */
    export function reply(id: number | string): CommonEvent.Segment {
        return { type: "reply", data: { id: String(id) } };
    }

    /**
     * Create record (voice) segment
     */
    export function record(file: string, options?: {
        magic?: boolean;
        url?: string;
        cache?: boolean;
        proxy?: boolean;
        timeout?: number;
    }): CommonEvent.Segment {
        return {
            type: "record",
            data: {
                file,
                ...(options?.magic !== undefined && { magic: options.magic ? 1 : 0 }),
                ...(options?.url && { url: options.url }),
                ...(options?.cache !== undefined && { cache: options.cache ? 1 : 0 }),
                ...(options?.proxy !== undefined && { proxy: options.proxy ? 1 : 0 }),
                ...(options?.timeout && { timeout: options.timeout }),
            },
        };
    }

    /**
     * Create video segment
     */
    export function video(file: string, options?: {
        url?: string;
        cache?: boolean;
        proxy?: boolean;
        timeout?: number;
    }): CommonEvent.Segment {
        return {
            type: "video",
            data: {
                file,
                ...(options?.url && { url: options.url }),
                ...(options?.cache !== undefined && { cache: options.cache ? 1 : 0 }),
                ...(options?.proxy !== undefined && { proxy: options.proxy ? 1 : 0 }),
                ...(options?.timeout && { timeout: options.timeout }),
            },
        };
    }

    /**
     * Create share segment
     */
    export function share(url: string, title: string, options?: {
        content?: string;
        image?: string;
    }): CommonEvent.Segment {
        return {
            type: "share",
            data: {
                url,
                title,
                ...(options?.content && { content: options.content }),
                ...(options?.image && { image: options.image }),
            },
        };
    }

    /**
     * Create music segment
     */
    export function music(
        type: "qq" | "163" | "xm",
        id: string
    ): CommonEvent.Segment;
    export function music(
        type: "custom",
        options: {
            url: string;
            audio: string;
            title: string;
            content?: string;
            image?: string;
        }
    ): CommonEvent.Segment;
    export function music(
        type: "qq" | "163" | "xm" | "custom",
        idOrOptions: string | any
    ): CommonEvent.Segment {
        if (type === "custom") {
            return {
                type: "music",
                data: {
                    type: "custom",
                    ...idOrOptions,
                },
            };
        }
        return {
            type: "music",
            data: {
                type,
                id: idOrOptions,
            },
        };
    }

    /**
     * Create location segment
     */
    export function location(lat: number, lon: number, options?: {
        title?: string;
        content?: string;
    }): CommonEvent.Segment {
        return {
            type: "location",
            data: {
                lat,
                lon,
                ...(options?.title && { title: options.title }),
                ...(options?.content && { content: options.content }),
            },
        };
    }

    /**
     * Create forward segment
     */
    export function forward(id: string): CommonEvent.Segment {
        return { type: "forward", data: { id } };
    }

    /**
     * Create node segment (for custom forward messages)
     */
    export function node(options: {
        id?: string;
        user_id?: number;
        nickname?: string;
        content?: CommonEvent.Segment[] | string;
    }): CommonEvent.Segment {
        return {
            type: "node",
            data: options,
        };
    }

    /**
     * Create poke segment
     */
    export function poke(type: string, id: string): CommonEvent.Segment {
        return { type: "poke", data: { type, id } };
    }

    /**
     * Create anonymous segment
     */
    export function anonymous(ignore?: boolean): CommonEvent.Segment {
        return {
            type: "anonymous",
            data: { ...(ignore !== undefined && { ignore: ignore ? 1 : 0 }) },
        };
    }

    /**
     * Create shake segment
     */
    export function shake(): CommonEvent.Segment {
        return { type: "shake", data: {} };
    }

    /**
     * Create JSON segment
     */
    export function json(data: string | object): CommonEvent.Segment {
        return {
            type: "json",
            data: { data: typeof data === "string" ? data : JSON.stringify(data) },
        };
    }

    /**
     * Create XML segment
     */
    export function xml(data: string): CommonEvent.Segment {
        return { type: "xml", data: { data } };
    }
}

