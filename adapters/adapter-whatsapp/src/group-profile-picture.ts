import { WhatsAppApiError } from "./errors.js";

const MAX_PROFILE_PICTURE_BYTES = 5 * 1024 * 1024;
const MIN_PROFILE_PICTURE_SIDE = 192;

/** 按 Groups API 约束验证头像内容，而不是信任调用方声明的 MIME。 */
export function validateGroupProfilePicture(data: Uint8Array, contentType: string): void {
    if (contentType !== "image/jpeg") invalid("群头像只支持 image/jpeg");
    if (data.byteLength > MAX_PROFILE_PICTURE_BYTES) invalid("群头像不能超过 5MB");
    const dimensions = readJpegDimensions(data);
    if (!dimensions) invalid("群头像必须是有效 JPEG");
    if (dimensions.width !== dimensions.height || dimensions.width < MIN_PROFILE_PICTURE_SIDE) {
        invalid("群头像必须是至少 192×192 的正方形 JPEG");
    }
}

function readJpegDimensions(data: Uint8Array): { width: number; height: number } | undefined {
    if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return undefined;
    let offset = 2;
    while (offset + 3 < data.length) {
        if (data[offset] !== 0xff) return undefined;
        while (data[offset] === 0xff) offset += 1;
        const marker = data[offset++];
        if (marker === undefined || marker === 0xd9 || marker === 0xda) return undefined;
        if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
        if (offset + 1 >= data.length) return undefined;
        const length = (data[offset] << 8) | data[offset + 1];
        if (length < 2 || offset + length > data.length) return undefined;
        if (isStartOfFrame(marker) && length >= 7) {
            return {
                height: (data[offset + 3] << 8) | data[offset + 4],
                width: (data[offset + 5] << 8) | data[offset + 6],
            };
        }
        offset += length;
    }
    return undefined;
}

function isStartOfFrame(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker);
}

function invalid(message: string): never {
    throw new WhatsAppApiError(`WhatsApp ${message}`, { code: "WHATSAPP_INVALID_PARAMETER" });
}
