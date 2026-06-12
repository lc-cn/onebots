/**
 * 邮件 Bot 客户端
 * 基于 nodemailer (SMTP) 和 imap (IMAP) 封装
 */
import { EventEmitter } from 'events';
import nodemailer, { Transporter } from 'nodemailer';
import Imap from 'imap';
import { simpleParser, ParsedMail } from 'mailparser';
import type { EmailConfig, EmailMessage } from './types.js';
import { createHttpsProxyAgent } from '@onebots/core';

export class EmailBot extends EventEmitter {
    private config: EmailConfig;
    private transporter!: Transporter;
    private imap!: Imap;
    private isConnected: boolean = false;
    private isListening: boolean = false;
    private pollTimer?: NodeJS.Timeout;

    constructor(config: EmailConfig) {
        super();
        this.config = config;
    }

    /**
     * 初始化 SMTP 传输器
     */
    private async initSMTP(): Promise<void> {
        const smtpConfig = this.config.smtp;
        
        const transporterConfig: any = {
            host: smtpConfig.host,
            port: smtpConfig.port || 587,
            secure: smtpConfig.secure ?? false,
            requireTLS: smtpConfig.requireTLS ?? true,
            auth: {
                user: smtpConfig.user,
                pass: smtpConfig.password,
            },
        };

        // 配置代理（如果需要）
        if (smtpConfig.proxy?.url) {
            const agent = await createHttpsProxyAgent(smtpConfig.proxy);
            if (agent) {
                transporterConfig.agent = agent;
            } else {
                console.warn('[Email] 创建代理失败，将直接连接');
            }
        }

        this.transporter = nodemailer.createTransport(transporterConfig);
        
        // 验证连接
        await this.transporter.verify();
        console.log('[Email] SMTP 连接验证成功');
    }

    /**
     * 初始化 IMAP 连接
     */
    private async initIMAP(): Promise<void> {
        return new Promise((resolve, reject) => {
            const imapConfig = this.config.imap;
            
            const imapOptions: Imap.Config = {
                user: imapConfig.user,
                password: imapConfig.password,
                host: imapConfig.host,
                port: imapConfig.port || 993,
                tls: imapConfig.tls ?? true,
                tlsOptions: {
                    rejectUnauthorized: false, // 允许自签名证书
                },
            };

            this.imap = new Imap(imapOptions);

            this.imap.once('ready', () => {
                console.log('[Email] IMAP 连接成功');
                this.isConnected = true;
                resolve();
            });

            this.imap.once('error', (err: Error) => {
                console.error('[Email] IMAP 连接错误:', err);
                this.isConnected = false;
                reject(err);
            });

            this.imap.once('end', () => {
                console.log('[Email] IMAP 连接已关闭');
                this.isConnected = false;
            });

            this.imap.connect();
        });
    }

    /**
     * 启动 Bot（初始化连接）
     */
    async start(): Promise<void> {
        try {
            await this.initSMTP();
            await this.initIMAP();
            await this.openMailbox();
            this.emit('ready');
            this.startListening();
        } catch (error) {
            console.error('[Email] 启动失败:', error);
            throw error;
        }
    }

    /**
     * 打开邮箱文件夹
     */
    private async openMailbox(): Promise<void> {
        return new Promise((resolve, reject) => {
            const mailbox = this.config.imap.mailbox || 'INBOX';
            this.imap.openBox(mailbox, false, (err, box) => {
                if (err) {
                    reject(err);
                } else {
                    console.log(`[Email] 已打开邮箱: ${mailbox}`);
                    resolve();
                }
            });
        });
    }

    /**
     * 开始监听新邮件
     */
    private startListening(): void {
        if (this.isListening) return;
        this.isListening = true;

        const pollInterval = this.config.imap.pollInterval || 30000;

        // 立即检查一次
        this.checkNewEmails();

        // 定时轮询
        this.pollTimer = setInterval(() => {
            if (this.isConnected) {
                this.checkNewEmails();
            }
        }, pollInterval);

        // 监听新邮件通知（如果服务器支持）
        this.imap.on('mail', () => {
            if (this.isConnected) {
                this.checkNewEmails();
            }
        });
    }

    /**
     * 检查新邮件
     */
    private async checkNewEmails(): Promise<void> {
        return new Promise((resolve, reject) => {
            this.imap.search(['UNSEEN'], (err, results) => {
                if (err) {
                    console.error('[Email] 搜索邮件失败:', err);
                    reject(err);
                    return;
                }

                if (!results || results.length === 0) {
                    resolve();
                    return;
                }

                const fetch = this.imap.fetch(results, {
                    bodies: '',
                    struct: true,
                });

                fetch.on('message', (msg, seqno) => {
                    msg.on('body', (stream) => {
                        simpleParser(stream, (err, parsed) => {
                            if (err) {
                                console.error('[Email] 解析邮件失败:', err);
                                return;
                            }
                            this.handleNewEmail(parsed);
                        });
                    });
                });

                fetch.once('end', () => {
                    resolve();
                });

                fetch.once('error', (err) => {
                    console.error('[Email] 获取邮件失败:', err);
                    reject(err);
                });
            });
        });
    }

    /**
     * 处理新邮件
     */
    private handleNewEmail(parsed: ParsedMail): void {
        const emailMessage: EmailMessage = {
            id: parsed.messageId || `${Date.now()}-${Math.random()}`,
            subject: parsed.subject || '',
            from: {
                address: parsed.from?.value[0]?.address || '',
                name: parsed.from?.value[0]?.name,
            },
            to: parsed.to?.value.map(addr => ({
                address: addr.address,
                name: addr.name,
            })) || [],
            cc: parsed.cc?.value.map(addr => ({
                address: addr.address,
                name: addr.name,
            })),
            bcc: parsed.bcc?.value.map(addr => ({
                address: addr.address,
                name: addr.name,
            })),
            html: parsed.html || undefined,
            text: parsed.text || undefined,
            attachments: parsed.attachments?.map(att => ({
                filename: att.filename || 'attachment',
                contentType: att.contentType || 'application/octet-stream',
                content: att.content as Buffer,
            })),
            date: parsed.date || new Date(),
            inReplyTo: parsed.inReplyTo || undefined,
            references: parsed.references || undefined,
        };

        // 标记为已读
        this.markAsRead(parsed.messageId || emailMessage.id);

        // 触发新邮件事件
        this.emit('email', emailMessage);
    }

    /**
     * 标记邮件为已读
     */
    private markAsRead(messageId: string): void {
        // 这里需要根据 IMAP 的 UID 来标记，简化处理
        // 实际实现中需要保存 UID 映射
    }

    /**
     * 发送邮件
     */
    async sendEmail(options: {
        to: string | string[];
        subject: string;
        text?: string;
        html?: string;
        attachments?: Array<{
            filename: string;
            content: Buffer | string;
            contentType?: string;
        }>;
        inReplyTo?: string;
        references?: string[];
    }): Promise<string> {
        const mailOptions = {
            from: this.config.fromName
                ? `"${this.config.fromName}" <${this.config.from}>`
                : this.config.from,
            to: Array.isArray(options.to) ? options.to.join(', ') : options.to,
            subject: options.subject,
            text: options.text,
            html: options.html,
            attachments: options.attachments?.map(att => ({
                filename: att.filename,
                content: att.content,
                contentType: att.contentType,
            })),
            inReplyTo: options.inReplyTo,
            references: options.references?.join(' '),
        };

        const info = await this.transporter.sendMail(mailOptions);
        return info.messageId || '';
    }

    /**
     * 停止 Bot
     */
    async stop(): Promise<void> {
        this.isListening = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = undefined;
        }
        if (this.imap) {
            this.imap.end();
        }
        if (this.transporter) {
            this.transporter.close();
        }
        this.emit('stop');
    }
}

