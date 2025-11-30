/**
 * 微信公众号工具函数
 */
import { createHash, createDecipheriv } from 'crypto';

/**
 * 验证微信服务器签名
 */
export function verifySignature(token: string, signature: string, timestamp: string, nonce: string, encrypt?: string): boolean {
    const arr = encrypt 
        ? [token, timestamp, nonce, encrypt].sort()
        : [token, timestamp, nonce].sort();
    const str = arr.join('');
    const sha1 = createHash('sha1').update(str).digest('hex');
    return sha1 === signature;
}

/**
 * 解密消息（加密模式）
 */
export function decryptMessage(encryptedMsg: string, encodingAESKey: string): string {
    if (!encodingAESKey) {
        throw new Error('未配置 encodingAESKey，无法解密消息');
    }

    try {
        const key = Buffer.from(encodingAESKey + '=', 'base64');
        const iv = key.slice(0, 16);
        
        const decipher = createDecipheriv('aes-256-cbc', key, iv);
        decipher.setAutoPadding(false);
        
        let decrypted = Buffer.concat([
            decipher.update(encryptedMsg, 'base64'),
            decipher.final()
        ]);
        
        // 移除填充
        const pad = decrypted[decrypted.length - 1];
        decrypted = decrypted.slice(0, decrypted.length - pad);
        
        // 提取消息内容
        const content = decrypted.slice(16);
        const msgLength = content.readUInt32BE(0);
        const result = content.slice(4, msgLength + 4).toString();
        
        return result;
    } catch (error: any) {
        throw new Error(`解密消息失败: ${error.message}`);
    }
}

/**
 * 解析 XML 消息
 */
export function parseXML(xml: string): Record<string, any> {
    const message: any = {};
    
    // 简单的 XML 解析
    const matches = xml.matchAll(/<(\w+)>(?:<!\[CDATA\[(.*?)\]\]>|(\d+))<\/\1>/g);
    for (const match of matches) {
        const [, key, cdataValue, numValue] = match;
        message[key] = cdataValue || (numValue ? parseInt(numValue) : numValue);
    }
    
    return message;
}

/**
 * 构建被动回复 XML
 */
export function buildPassiveReply(toUser: string, fromUser: string, message: {
    type: 'text' | 'image' | 'voice' | 'video' | 'music' | 'news';
    content?: string;
    mediaId?: string;
    title?: string;
    description?: string;
    musicUrl?: string;
    hqMusicUrl?: string;
    thumbMediaId?: string;
    articles?: Array<{
        title: string;
        description?: string;
        picUrl?: string;
        url?: string;
    }>;
}): string {
    const timestamp = Math.floor(Date.now() / 1000);
    let contentXml = '';

    switch (message.type) {
        case 'text':
            contentXml = `<Content><![CDATA[${message.content}]]></Content>`;
            break;
        case 'image':
            contentXml = `<Image><MediaId><![CDATA[${message.mediaId}]]></MediaId></Image>`;
            break;
        case 'voice':
            contentXml = `<Voice><MediaId><![CDATA[${message.mediaId}]]></MediaId></Voice>`;
            break;
        case 'video':
            contentXml = `<Video>
                <MediaId><![CDATA[${message.mediaId}]]></MediaId>
                <Title><![CDATA[${message.title || ''}]]></Title>
                <Description><![CDATA[${message.description || ''}]]></Description>
            </Video>`;
            break;
        case 'music':
            contentXml = `<Music>
                <Title><![CDATA[${message.title || ''}]]></Title>
                <Description><![CDATA[${message.description || ''}]]></Description>
                <MusicUrl><![CDATA[${message.musicUrl || ''}]]></MusicUrl>
                <HQMusicUrl><![CDATA[${message.hqMusicUrl || ''}]]></HQMusicUrl>
                <ThumbMediaId><![CDATA[${message.thumbMediaId || ''}]]></ThumbMediaId>
            </Music>`;
            break;
        case 'news':
            const articles = message.articles || [];
            const articlesXml = articles.map(item => `
                <item>
                    <Title><![CDATA[${item.title}]]></Title>
                    <Description><![CDATA[${item.description || ''}]]></Description>
                    <PicUrl><![CDATA[${item.picUrl || ''}]]></PicUrl>
                    <Url><![CDATA[${item.url || ''}]]></Url>
                </item>
            `).join('');
            contentXml = `<ArticleCount>${articles.length}</ArticleCount><Articles>${articlesXml}</Articles>`;
            break;
    }

    return `<xml>
        <ToUserName><![CDATA[${toUser}]]></ToUserName>
        <FromUserName><![CDATA[${fromUser}]]></FromUserName>
        <CreateTime>${timestamp}</CreateTime>
        <MsgType><![CDATA[${message.type}]]></MsgType>
        ${contentXml}
    </xml>`;
}
