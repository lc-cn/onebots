import {
    createCipheriv,
    createDecipheriv,
    createHash,
    randomBytes,
    timingSafeEqual,
} from "node:crypto";

const RANDOM_PREFIX_BYTES = 16;
const PKCS7_BLOCK_SIZE = 32;

/** 钉钉 HTTP 回调的签名与 AES-256-CBC 编解码器。 */
export class DingTalkCallbackCrypto {
    private readonly aesKey: Buffer;

    constructor(
        private readonly token: string,
        encodingAesKey: string,
        private readonly corpId?: string,
    ) {
        if (!token) throw new Error("钉钉加密回调必须配置 token");
        if (!/^[A-Za-z0-9+/]{43}$/.test(encodingAesKey)) {
            throw new Error("钉钉 encrypt_key 必须为 43 字符 EncodingAESKey");
        }
        this.aesKey = Buffer.from(`${encodingAesKey}=`, "base64");
        if (this.aesKey.length !== 32) throw new Error("钉钉 encrypt_key 解码后长度无效");
    }

    decrypt(encrypted: string, signature: string, timestamp: string, nonce: string): string {
        if (!this.verify(signature, timestamp, nonce, encrypted)) {
            throw new Error("钉钉回调签名验证失败");
        }
        const decipher = createDecipheriv("aes-256-cbc", this.aesKey, this.aesKey.subarray(0, 16));
        decipher.setAutoPadding(false);
        const padded = Buffer.concat([
            decipher.update(Buffer.from(encrypted, "base64")),
            decipher.final(),
        ]);
        const plain = removePadding(padded);
        if (plain.length < RANDOM_PREFIX_BYTES + 4) throw new Error("钉钉回调密文结构无效");
        const messageLength = plain.readUInt32BE(RANDOM_PREFIX_BYTES);
        const messageStart = RANDOM_PREFIX_BYTES + 4;
        const messageEnd = messageStart + messageLength;
        if (messageEnd > plain.length) throw new Error("钉钉回调消息长度无效");
        const receivedCorpId = plain.subarray(messageEnd).toString("utf8");
        if (this.corpId && receivedCorpId && receivedCorpId !== this.corpId) {
            throw new Error("钉钉回调 CorpId 不匹配");
        }
        return plain.subarray(messageStart, messageEnd).toString("utf8");
    }

    encryptResponse(message: string, timestamp = Date.now().toString(), nonce = randomNonce()) {
        const messageBuffer = Buffer.from(message);
        const length = Buffer.allocUnsafe(4);
        length.writeUInt32BE(messageBuffer.length);
        const plain = Buffer.concat([
            randomBytes(RANDOM_PREFIX_BYTES),
            length,
            messageBuffer,
            Buffer.from(this.corpId || ""),
        ]);
        const cipher = createCipheriv("aes-256-cbc", this.aesKey, this.aesKey.subarray(0, 16));
        cipher.setAutoPadding(false);
        const encrypted = Buffer.concat([
            cipher.update(addPadding(plain)),
            cipher.final(),
        ]).toString("base64");
        return {
            msg_signature: this.sign(timestamp, nonce, encrypted),
            timeStamp: timestamp,
            nonce,
            encrypt: encrypted,
        };
    }

    private verify(
        signature: string,
        timestamp: string,
        nonce: string,
        encrypted: string,
    ): boolean {
        const expected = this.sign(timestamp, nonce, encrypted);
        const actualBuffer = Buffer.from(signature);
        const expectedBuffer = Buffer.from(expected);
        return (
            actualBuffer.length === expectedBuffer.length &&
            timingSafeEqual(actualBuffer, expectedBuffer)
        );
    }

    private sign(timestamp: string, nonce: string, encrypted: string): string {
        return createHash("sha1")
            .update([this.token, timestamp, nonce, encrypted].sort().join(""))
            .digest("hex");
    }
}

function addPadding(value: Buffer): Buffer {
    const paddingLength = PKCS7_BLOCK_SIZE - (value.length % PKCS7_BLOCK_SIZE);
    return Buffer.concat([value, Buffer.alloc(paddingLength, paddingLength)]);
}

function removePadding(value: Buffer): Buffer {
    const paddingLength = value.at(-1) || 0;
    if (paddingLength < 1 || paddingLength > PKCS7_BLOCK_SIZE) {
        throw new Error("钉钉回调 PKCS#7 填充无效");
    }
    for (let index = value.length - paddingLength; index < value.length; index++) {
        if (value[index] !== paddingLength) throw new Error("钉钉回调 PKCS#7 填充无效");
    }
    return value.subarray(0, -paddingLength);
}

function randomNonce(): string {
    return randomBytes(8).toString("hex");
}
