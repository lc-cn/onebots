import { EventEmitter } from "events";
import axios, { AxiosInstance } from "axios";
import * as crypto from "crypto";
import { parseStringPromise, Builder } from "xml2js";
import { Logger } from "log4js";

/**
 * WeChat Official Account Bot Configuration
 */
export interface WeChatMPBotConfig {
    appId: string;
    appSecret: string;
    token: string;
    encodingAESKey?: string;
    encrypt?: boolean;
    logger?: Logger;
}

/**
 * WeChat message structure from MP platform
 */
export interface WeChatMPMessage {
    ToUserName: string;
    FromUserName: string;
    CreateTime: number;
    MsgType: string;
    MsgId?: string;
    Content?: string;
    PicUrl?: string;
    MediaId?: string;
    Format?: string;
    Recognition?: string;
    ThumbMediaId?: string;
    Location_X?: string;
    Location_Y?: string;
    Scale?: string;
    Label?: string;
    Title?: string;
    Description?: string;
    Url?: string;
    Event?: string;
    EventKey?: string;
}

/**
 * WeChat Official Account Bot Client
 * Handles WeChat MP API interactions
 */
export class WeChatMPBot extends EventEmitter {
    private accessToken: string = "";
    private tokenExpireTime: number = 0;
    private tokenRefreshTimer?: NodeJS.Timeout;
    private http: AxiosInstance;
    private isRunning: boolean = false;
    private logger?: Logger;

    constructor(public config: WeChatMPBotConfig) {
        super();
        this.logger = config.logger;
        this.http = axios.create({
            baseURL: "https://api.weixin.qq.com",
            timeout: 30000,
        });
    }

    /**
     * Start the bot
     */
    async start(): Promise<void> {
        if (this.isRunning) return;
        this.isRunning = true;

        // Refresh access token
        await this.refreshAccessToken();

        // Start token refresh timer
        this.startTokenRefreshTimer();
    }

    /**
     * Stop the bot
     */
    async stop(): Promise<void> {
        this.isRunning = false;

        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
            this.tokenRefreshTimer = undefined;
        }
    }

    /**
     * Verify WeChat signature
     */
    verifySignature(signature: string, timestamp: string, nonce: string): boolean {
        const arr = [this.config.token, timestamp, nonce].sort();
        const str = arr.join("");
        const sha1 = crypto.createHash("sha1");
        sha1.update(str);
        return sha1.digest("hex") === signature;
    }

    /**
     * Parse XML message from WeChat
     */
    async parseXMLMessage(xml: string): Promise<WeChatMPMessage> {
        const result = await parseStringPromise(xml, { explicitArray: false });
        return result.xml;
    }

    /**
     * Build XML reply message
     */
    buildXMLReply(toUser: string, fromUser: string, type: string, content: any): string {
        const builder = new Builder({ rootName: "xml", headless: true });
        const message: any = {
            ToUserName: { _cdata: toUser },
            FromUserName: { _cdata: fromUser },
            CreateTime: Math.floor(Date.now() / 1000),
            MsgType: { _cdata: type },
        };

        if (type === "text") {
            message.Content = { _cdata: content };
        } else if (type === "image") {
            message.Image = { MediaId: { _cdata: content.mediaId } };
        } else if (type === "voice") {
            message.Voice = { MediaId: { _cdata: content.mediaId } };
        } else if (type === "video") {
            message.Video = {
                MediaId: { _cdata: content.mediaId },
                Title: content.title ? { _cdata: content.title } : undefined,
                Description: content.description ? { _cdata: content.description } : undefined,
            };
        }

        return builder.buildObject(message);
    }

    /**
     * Refresh access token
     */
    private async refreshAccessToken(): Promise<void> {
        try {
            const response = await this.http.get("/cgi-bin/token", {
                params: {
                    grant_type: "client_credential",
                    appid: this.config.appId,
                    secret: this.config.appSecret,
                },
            });

            if (response.data.access_token) {
                this.accessToken = response.data.access_token;
                this.tokenExpireTime = Date.now() + (response.data.expires_in - 200) * 1000;
            } else {
                throw new Error(`Failed to get access token: ${JSON.stringify(response.data)}`);
            }
        } catch (error) {
            if (this.logger) {
                this.logger.error("Failed to refresh access token:", error);
            }
            throw error;
        }
    }

    /**
     * Start token refresh timer
     */
    private startTokenRefreshTimer(): void {
        if (this.tokenRefreshTimer) {
            clearTimeout(this.tokenRefreshTimer);
        }

        const refreshDelay = this.tokenExpireTime - Date.now();
        this.tokenRefreshTimer = setTimeout(
            async () => {
                await this.refreshAccessToken();
                this.startTokenRefreshTimer();
            },
            Math.max(refreshDelay, 60000),
        ); // At least 1 minute
    }

    /**
     * Send customer service message
     */
    async sendCustomerServiceMessage(
        toUser: string,
        msgType: string,
        content: any,
    ): Promise<string> {
        if (!this.accessToken || Date.now() >= this.tokenExpireTime) {
            await this.refreshAccessToken();
        }

        const message: any = {
            touser: toUser,
            msgtype: msgType,
        };

        if (msgType === "text") {
            message.text = { content };
        } else if (msgType === "image") {
            message.image = { media_id: content.mediaId };
        } else if (msgType === "voice") {
            message.voice = { media_id: content.mediaId };
        } else if (msgType === "video") {
            message.video = {
                media_id: content.mediaId,
                thumb_media_id: content.thumbMediaId,
                title: content.title,
                description: content.description,
            };
        }

        try {
            const response = await this.http.post("/cgi-bin/message/custom/send", message, {
                params: { access_token: this.accessToken },
            });

            if (response.data.errcode !== 0) {
                throw new Error(`WeChat API error: ${response.data.errmsg}`);
            }

            return String(Date.now());
        } catch (error) {
            if (this.logger) {
                this.logger.error("Failed to send message:", error);
            }
            throw error;
        }
    }

    /**
     * Get user info
     */
    async getUserInfo(openid: string): Promise<any> {
        if (!this.accessToken || Date.now() >= this.tokenExpireTime) {
            await this.refreshAccessToken();
        }

        try {
            const response = await this.http.get("/cgi-bin/user/info", {
                params: {
                    access_token: this.accessToken,
                    openid,
                    lang: "zh_CN",
                },
            });

            if (response.data.errcode && response.data.errcode !== 0) {
                throw new Error(`WeChat API error: ${response.data.errmsg}`);
            }

            return response.data;
        } catch (error) {
            if (this.logger) {
                this.logger.error("Failed to get user info:", error);
            }
            throw error;
        }
    }

    /**
     * Upload media
     */
    async uploadMedia(
        type: "image" | "voice" | "video" | "thumb",
        buffer: Buffer,
    ): Promise<string> {
        if (!this.accessToken || Date.now() >= this.tokenExpireTime) {
            await this.refreshAccessToken();
        }

        try {
            const FormData = require("form-data");
            const formData = new FormData();
            formData.append("media", buffer, {
                filename: `file.${type === "image" ? "jpg" : type === "voice" ? "amr" : "mp4"}`,
            });

            const response = await this.http.post("/cgi-bin/media/upload", formData, {
                params: {
                    access_token: this.accessToken,
                    type,
                },
                headers: formData.getHeaders(),
            });

            if (response.data.errcode && response.data.errcode !== 0) {
                throw new Error(`WeChat API error: ${response.data.errmsg}`);
            }

            return response.data.media_id;
        } catch (error) {
            if (this.logger) {
                this.logger.error("Failed to upload media:", error);
            }
            throw error;
        }
    }

    /**
     * Get user list
     */
    async getUserList(
        nextOpenId?: string,
    ): Promise<{ total: number; count: number; data: { openid: string[] }; next_openid: string }> {
        if (!this.accessToken || Date.now() >= this.tokenExpireTime) {
            await this.refreshAccessToken();
        }

        try {
            const response = await this.http.get("/cgi-bin/user/get", {
                params: {
                    access_token: this.accessToken,
                    next_openid: nextOpenId || "",
                },
            });

            if (response.data.errcode && response.data.errcode !== 0) {
                throw new Error(`WeChat API error: ${response.data.errmsg}`);
            }

            return response.data;
        } catch (error) {
            if (this.logger) {
                this.logger.error("Failed to get user list:", error);
            }
            throw error;
        }
    }
}
