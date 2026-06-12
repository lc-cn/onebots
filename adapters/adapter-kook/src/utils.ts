/**
 * KOOK (开黑了) 工具函数
 */
import { createDecipheriv, createHash } from 'crypto';
import type { KookCard, KookCardModule } from './types.js';

/**
 * 验证 Webhook 请求
 */
export function verifyWebhook(body: { d?: { verify_token?: string } }, verifyToken: string): boolean {
    if (!body || !body.d) return false;
    return body.d.verify_token === verifyToken;
}

/**
 * 解密 Webhook 消息（当配置了 encryptKey 时）
 */
export function decryptWebhookMessage(encryptedData: string, encryptKey: string): string {
    if (!encryptKey) {
        throw new Error('未配置 encryptKey，无法解密消息');
    }

    try {
        // 解码 base64
        const encrypted = Buffer.from(encryptedData, 'base64');
        
        // 提取 IV（前 16 字节）
        const iv = encrypted.slice(0, 16);
        const ciphertext = encrypted.slice(16);
        
        // 生成密钥（encryptKey 需要是 32 字节）
        const key = Buffer.alloc(32);
        Buffer.from(encryptKey).copy(key);
        
        // 解密
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        let decrypted = decipher.update(ciphertext);
        decrypted = Buffer.concat([decrypted, decipher.final()]);
        
        return decrypted.toString('utf-8');
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`解密消息失败: ${message}`);
    }
}

/**
 * 解析 KMarkdown 消息为文本
 */
export function parseKMarkdown(content: string): string {
    if (!content) return '';
    
    // 移除 KMarkdown 格式标记
    let text = content;
    
    // 移除加粗 **text**
    text = text.replace(/\*\*(.+?)\*\*/g, '$1');
    
    // 移除斜体 *text*
    text = text.replace(/\*(.+?)\*/g, '$1');
    
    // 移除删除线 ~~text~~
    text = text.replace(/~~(.+?)~~/g, '$1');
    
    // 移除下划线 (ins)text(/ins)
    text = text.replace(/\(ins\)(.+?)\(\/ins\)/g, '$1');
    
    // 移除剧透 (spl)text(/spl)
    text = text.replace(/\(spl\)(.+?)\(\/spl\)/g, '$1');
    
    // 提取链接文本 [text](url)
    text = text.replace(/\[(.+?)\]\(.+?\)/g, '$1');
    
    // 提取 @用户 (met)id(/met)
    text = text.replace(/\(met\)(\w+)\(\/met\)/g, '@$1');
    
    // 提取 @角色 (rol)id(/rol)
    text = text.replace(/\(rol\)(\w+)\(\/rol\)/g, '@角色$1');
    
    // 提取 #频道 (chn)id(/chn)
    text = text.replace(/\(chn\)(\w+)\(\/chn\)/g, '#$1');
    
    // 提取表情 (emj)name(/emj)[id]
    text = text.replace(/\(emj\)(.+?)\(\/emj\)\[.+?\]/g, ':$1:');
    
    // 移除代码块 ```code```
    text = text.replace(/```[\s\S]*?```/g, '[代码块]');
    
    // 移除行内代码 `code`
    text = text.replace(/`(.+?)`/g, '$1');
    
    return text.trim();
}

/**
 * 将文本转换为 KMarkdown 格式
 */
export function textToKMarkdown(text: string): string {
    // 转义特殊字符
    return text
        .replace(/\\/g, '\\\\')
        .replace(/\*/g, '\\*')
        .replace(/~/g, '\\~')
        .replace(/`/g, '\\`')
        .replace(/\[/g, '\\[')
        .replace(/\(/g, '\\(');
}

/**
 * 构建 @用户 的 KMarkdown
 */
export function mentionUser(userId: string): string {
    return `(met)${userId}(/met)`;
}

/**
 * 构建 @全体成员 的 KMarkdown
 */
export function mentionAll(): string {
    return '(met)all(/met)';
}

/**
 * 构建 @在线成员 的 KMarkdown
 */
export function mentionHere(): string {
    return '(met)here(/met)';
}

/**
 * 构建 @角色 的 KMarkdown
 */
export function mentionRole(roleId: number): string {
    return `(rol)${roleId}(/rol)`;
}

/**
 * 构建 #频道 的 KMarkdown
 */
export function mentionChannel(channelId: string): string {
    return `(chn)${channelId}(/chn)`;
}

/**
 * 构建表情的 KMarkdown
 */
export function emojiKMarkdown(emojiName: string, emojiId: string): string {
    return `(emj)${emojiName}(emj)[${emojiId}]`;
}

/**
 * 构建链接的 KMarkdown
 */
export function linkKMarkdown(text: string, url: string): string {
    return `[${text}](${url})`;
}

/**
 * 构建加粗的 KMarkdown
 */
export function boldKMarkdown(text: string): string {
    return `**${text}**`;
}

/**
 * 构建斜体的 KMarkdown
 */
export function italicKMarkdown(text: string): string {
    return `*${text}*`;
}

/**
 * 构建删除线的 KMarkdown
 */
export function strikethroughKMarkdown(text: string): string {
    return `~~${text}~~`;
}

/**
 * 构建代码块的 KMarkdown
 */
export function codeBlockKMarkdown(code: string, language?: string): string {
    return `\`\`\`${language || ''}\n${code}\n\`\`\``;
}

/**
 * 构建行内代码的 KMarkdown
 */
export function inlineCodeKMarkdown(code: string): string {
    return `\`${code}\``;
}

/**
 * 构建引用的 KMarkdown
 */
export function quoteKMarkdown(text: string): string {
    return `> ${text}`;
}

/**
 * 构建分割线的 KMarkdown
 */
export function dividerKMarkdown(): string {
    return '---';
}

/**
 * 生成随机 nonce
 */
export function generateNonce(): string {
    return `${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
}

/**
 * 解析卡片消息
 */
export function parseCardMessage(content: string): KookCard[] {
    try {
        return JSON.parse(content);
    } catch {
        return [];
    }
}

/**
 * 构建简单文本卡片
 */
export function buildTextCard(text: string, theme: 'primary' | 'success' | 'danger' | 'warning' | 'info' | 'secondary' | 'none' = 'primary'): string {
    const card = [{
        type: 'card',
        theme,
        size: 'lg',
        modules: [{
            type: 'section',
            text: {
                type: 'plain-text',
                content: text,
            },
        }],
    }];
    return JSON.stringify(card);
}

/**
 * 构建图片卡片
 */
export function buildImageCard(imageUrl: string, title?: string): string {
    const modules: KookCardModule[] = [];
    
    if (title) {
        modules.push({
            type: 'header',
            text: {
                type: 'plain-text',
                content: title,
            },
        });
    }
    
    modules.push({
        type: 'container',
        elements: [{
            type: 'image',
            src: imageUrl,
        }],
    });
    
    const card = [{
        type: 'card',
        theme: 'none',
        size: 'lg',
        modules,
    }];
    return JSON.stringify(card);
}

/**
 * 计算消息签名（用于验证）
 */
export function calculateSignature(data: string, key: string): string {
    return createHash('sha256').update(data + key).digest('hex');
}
