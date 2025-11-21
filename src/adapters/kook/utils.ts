import { CommonEvent } from "@/common-types";

/**
 * Kook utility functions
 * Handles message format conversion and event transformation
 */
export class KookUtils {
    /**
     * Transform Kook event to CommonEvent format
     */
    transformEvent(uin: string, eventData: any): CommonEvent.Event | null {
        const { type, channel_type, extra } = eventData;

        // Message events
        if (type === 1) { // Text message
            return this.transformMessageEvent(uin, eventData);
        }

        // System events
        if (type === 255) {
            return this.transformSystemEvent(uin, eventData);
        }

        return null;
    }

    /**
     * Transform Kook message event to CommonEvent
     */
    private transformMessageEvent(uin: string, eventData: any): CommonEvent.Message {
        const { msg_id, msg_timestamp, author_id, content, channel_type, target_id, extra } = eventData;
        const author = extra?.author || {};

        // Parse message content
        const message = this.parseKMarkdown(content, extra);

        const baseEvent: CommonEvent.Message = {
            id: msg_id,
            type: "message",
            platform: "kook",
            bot_id: uin,
            message_id: msg_id,
            message_type: channel_type === "GROUP" ? "group" : "private",
            timestamp: msg_timestamp * 1000,
            sender: {
                id: author_id,
                name: author.username || "",
            },
            message,
            raw_message: content,
        };

        if (channel_type === "GROUP") {
            baseEvent.group = {
                id: extra?.guild_id || target_id,
                name: extra?.guild_name || "",
            };
            (baseEvent as any).channel = {
                id: target_id,
                name: extra?.channel_name || "",
            };
        }

        return baseEvent;
    }

    /**
     * Transform Kook system event to CommonEvent
     */
    private transformSystemEvent(uin: string, eventData: any): CommonEvent.Event | null {
        const { extra } = eventData;
        const { type: systemType, body } = extra;

        switch (systemType) {
            case "added_reaction": // User added reaction
            case "deleted_reaction": // User deleted reaction
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "custom",
                    user: {
                        id: body.user_id,
                        name: "",
                    },
                    message_id: body.msg_id,
                    custom_type: "message_reaction",
                };

            case "updated_message": // Message updated
            case "deleted_message": // Message deleted
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "custom",
                    message_id: body.msg_id,
                    custom_type: systemType === "updated_message" ? "message_update" : "message_delete",
                };

            case "guild_member_online": // Member online
            case "guild_member_offline": // Member offline
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "custom",
                    user: {
                        id: body.user_id,
                        name: "",
                    },
                    group: {
                        id: body.guild_id,
                        name: "",
                    },
                    custom_type: systemType === "guild_member_online" ? "member_online" : "member_offline",
                };

            case "added_guild": // Bot added to guild
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "group_increase",
                    group: {
                        id: body.guild_id,
                        name: "",
                    },
                };

            case "deleted_guild": // Bot removed from guild
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "group_decrease",
                    group: {
                        id: body.guild_id,
                        name: "",
                    },
                };

            case "added_channel": // Channel created
            case "updated_channel": // Channel updated
            case "deleted_channel": // Channel deleted
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "custom",
                    channel: {
                        id: body.id,
                        name: body.name || "",
                    },
                    custom_type: "channel_update",
                };

            case "joined_guild": // User joined guild
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "group_increase",
                    user: {
                        id: body.user_id,
                        name: "",
                    },
                    group: {
                        id: body.guild_id,
                        name: "",
                    },
                };

            case "exited_guild": // User left guild
                return {
                    id: `${uin}_${Date.now()}`,
                    type: "notice",
                    platform: "kook",
                    bot_id: uin,
                    timestamp: Date.now(),
                    notice_type: "group_decrease",
                    user: {
                        id: body.user_id,
                        name: "",
                    },
                    group: {
                        id: body.guild_id,
                        name: "",
                    },
                };

            default:
                return null;
        }
    }

    /**
     * Parse KMarkdown to CommonEvent segments
     */
    parseKMarkdown(content: string, extra?: any): CommonEvent.Segment[] {
        const segments: CommonEvent.Segment[] = [];

        // Check for mentions in extra data
        if (extra?.mention) {
            extra.mention.forEach((userId: string) => {
                segments.push({
                    type: "at",
                    data: { user_id: userId },
                });
            });
        }

        // Check for mention_all
        if (extra?.mention_all) {
            segments.push({
                type: "at",
                data: { user_id: "all" },
            });
        }

        // Check for mention_roles
        if (extra?.mention_roles) {
            extra.mention_roles.forEach((roleId: string) => {
                segments.push({
                    type: "at",
                    data: { role_id: roleId },
                });
            });
        }

        // Parse content for images, videos, etc.
        // KMarkdown format: ![](url) for images
        const imageRegex = /!\[.*?\]\((.*?)\)/g;
        let match;
        let lastIndex = 0;

        while ((match = imageRegex.exec(content)) !== null) {
            // Add text before image
            if (match.index > lastIndex) {
                const text = content.substring(lastIndex, match.index).trim();
                if (text) {
                    segments.push({
                        type: "text",
                        data: { text },
                    });
                }
            }

            // Add image
            segments.push({
                type: "image",
                data: { url: match[1] },
            });

            lastIndex = match.index + match[0].length;
        }

        // Add remaining text
        if (lastIndex < content.length) {
            const text = content.substring(lastIndex).trim();
            if (text) {
                segments.push({
                    type: "text",
                    data: { text },
                });
            }
        }

        // If no segments parsed, treat entire content as text
        if (segments.length === 0) {
            segments.push({
                type: "text",
                data: { text: content },
            });
        }

        return segments;
    }

    /**
     * Convert CommonEvent segments to KMarkdown
     */
    segmentsToKMarkdown(segments: CommonEvent.Segment[]): string {
        let markdown = "";

        for (const segment of segments) {
            switch (segment.type) {
                case "text":
                    markdown += segment.data.text || "";
                    break;

                case "at":
                    if (segment.data.user_id === "all") {
                        markdown += "(met)all(met)";
                    } else if (segment.data.role_id) {
                        markdown += `(rol)${segment.data.role_id}(rol)`;
                    } else {
                        markdown += `(met)${segment.data.user_id}(met)`;
                    }
                    break;

                case "image":
                    markdown += `![](${segment.data.url || segment.data.file})`;
                    break;

                case "video":
                    markdown += `[视频](${segment.data.url || segment.data.file})`;
                    break;

                case "file":
                    markdown += `[文件](${segment.data.url || segment.data.file})`;
                    break;

                case "face":
                    // Kook emoji format
                    markdown += `(emj)${segment.data.id}(emj)[${segment.data.id}]`;
                    break;

                default:
                    // Unsupported segment type, ignore
                    break;
            }
        }

        return markdown;
    }

    /**
     * Parse user role from Kook roles array
     */
    parseRole(roles: number[]): "owner" | "admin" | "member" {
        if (!roles || roles.length === 0) {
            return "member";
        }

        // Kook role system: 0 = owner, 1 = admin, others = roles
        if (roles.includes(0)) {
            return "owner";
        }

        if (roles.includes(1)) {
            return "admin";
        }

        return "member";
    }

    /**
     * Convert message type code to readable name
     */
    getMessageTypeName(type: number): string {
        const types: Record<number, string> = {
            1: "text",
            2: "image",
            3: "video",
            4: "file",
            8: "audio",
            9: "kmarkdown",
            10: "card",
        };
        return types[type] || "unknown";
    }

    /**
     * Convert channel type to readable name
     */
    getChannelTypeName(type: string): string {
        const types: Record<string, string> = {
            GROUP: "group",
            PERSON: "private",
            BROADCAST: "broadcast",
        };
        return types[type] || "unknown";
    }
}

