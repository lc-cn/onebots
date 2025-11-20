import { Account } from "@/account";
import { Dict } from "@zhinjs/shared";

/**
 * Common message utilities
 * Provides helper methods for message formatting and transformation
 */
export namespace MessageUtils {
    /**
     * Format event payload with common fields
     * Removes internal fields and normalizes data
     */
    export function formatEventPayload(payload: Dict): Dict {
        return Object.fromEntries(
            Object.entries(payload).filter(([_, value]) => {
                return typeof value !== "function";
            }),
        );
    }

    /**
     * Normalize sender information
     * Ensures user_id is extracted from sender object if needed
     */
    export function normalizeSender(data: Dict): Dict {
        const sender = {
            ...(data?.sender || {}),
            user_id: data?.sender?.user_id || data?.sender?.tiny_id,
        };
        return {
            ...data,
            sender,
            user_id: data.user_id || sender.user_id,
        };
    }

    /**
     * Create self info object
     */
    export function createSelfInfo(platform: string, userId: string | number): Dict {
        return {
            platform,
            user_id: userId,
        };
    }

    /**
     * Add reply element to message
     * Handles both V11 and V12 formats
     */
    export function addReplyToMessage<V extends string>(
        message: any[],
        messageId: string | number,
        version: V,
        detailType?: string,
    ): any[] {
        const replyEl = {
            type: "reply",
            id: messageId,
        };

        // For group messages with @ mention as first element, replace it
        if (detailType === "group" && message[0]?.type === "at") {
            message[0] = replyEl;
        } else {
            message.unshift(replyEl);
        }

        return message;
    }

    /**
     * Clean internal fields from payload
     * Removes fields like group, member, discuss, friend which are internal
     */
    export function cleanInternalFields(payload: Dict, fieldsToRemove: string[] = []): Dict {
        const defaultFields = ["group", "member", "discuss", "friend"];
        const allFields = [...defaultFields, ...fieldsToRemove];

        const cleaned = { ...payload };
        allFields.forEach(field => {
            delete cleaned[field];
        });

        return cleaned;
    }

    /**
     * Extract message content as plain text
     * Recursively extracts text from message segments
     */
    export function extractPlainText(message: any): string {
        if (typeof message === "string") {
            return message;
        }

        if (Array.isArray(message)) {
            return message.map(extractPlainText).join("");
        }

        if (message && typeof message === "object") {
            if (message.type === "text") {
                return message.data?.text || message.text || "";
            }
            // For other types, return empty string or you could format them
            return "";
        }

        return "";
    }

    /**
     * Validate message format
     */
    export function isValidMessage(message: any): boolean {
        if (!message) return false;
        if (typeof message === "string") return message.length > 0;
        if (Array.isArray(message)) return message.length > 0;
        return true;
    }

    /**
     * Create message event payload
     */
    export function createMessageEvent(
        type: "message",
        detailType: string,
        data: Dict,
    ): Dict {
        return {
            type,
            detail_type: detailType,
            ...data,
        };
    }

    /**
     * Create notice event payload
     */
    export function createNoticeEvent(
        noticeType: string,
        data: Dict,
    ): Dict {
        return {
            type: "notice",
            detail_type: noticeType,
            notice_type: noticeType,
            ...data,
        };
    }

    /**
     * Create request event payload
     */
    export function createRequestEvent(
        requestType: string,
        data: Dict,
    ): Dict {
        return {
            type: "request",
            detail_type: requestType,
            request_type: requestType,
            ...data,
        };
    }
}
