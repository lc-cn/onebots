import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyMilkyToken(requiredToken: string | undefined, token: string | undefined) {
    return !requiredToken || token === requiredToken;
}

export function createMilkySignature(secret: string, body: string): string {
    return `sha1=${createHmac("sha1", secret).update(body).digest("hex")}`;
}

export function verifyMilkySignature(
    secret: string | undefined,
    body: string,
    signature: string | undefined,
): boolean {
    if (!secret) return true;
    if (!signature) return false;
    const expectedBytes = Buffer.from(createMilkySignature(secret, body));
    const actualBytes = Buffer.from(signature);
    return (
        actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes)
    );
}
