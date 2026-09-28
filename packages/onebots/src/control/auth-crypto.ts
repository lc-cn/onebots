import { createHash, timingSafeEqual } from "node:crypto";

export const HASH = /^[a-f0-9]{64}$/;

export function digest(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function matches(value: string, hash: string): boolean {
    return (
        typeof value === "string" &&
        value.length <= 128 &&
        timingSafeEqual(Buffer.from(digest(value), "hex"), Buffer.from(hash, "hex"))
    );
}
