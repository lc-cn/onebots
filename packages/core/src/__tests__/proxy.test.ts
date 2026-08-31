/**
 * 代理工具单元测试
 */
import { describe, it, expect } from 'vitest';
import { buildProxyUrl, maskProxyUrl } from '../proxy.js';

describe('buildProxyUrl', () => {
    it('基础代理 URL 构建', () => {
        expect(buildProxyUrl({ url: 'http://127.0.0.1:7890' })).toBe('http://127.0.0.1:7890/');
    });

    it('带用户名密码的代理 URL', () => {
        const url = buildProxyUrl({ url: 'http://127.0.0.1:7890', username: 'user', password: 'pass' });
        expect(url).toContain('user:pass@');
        expect(url).toContain('127.0.0.1:7890');
    });

    it('SOCKS5 URL 正确解析', () => {
        const url = buildProxyUrl({ url: 'socks5://127.0.0.1:1080' });
        // socks5:// 非标准协议, URL 对象可能不加尾随 /
        expect(url).toMatch(/socks5:\/\/127\.0\.0\.1:1080\/?$/);
    });

    it('用户名/密码中的特殊字符被正确编码', () => {
        const url = buildProxyUrl({ url: 'http://127.0.0.1:7890', username: 'user@name', password: 'p@ss' });
        expect(url).toContain('user%40name:p%40ss@');
    });
});

describe('maskProxyUrl', () => {
    it('脱敏密码', () => {
        expect(maskProxyUrl('http://user:secret@127.0.0.1:7890')).toBe('http://user:***@127.0.0.1:7890');
    });

    it('无密码的 URL 不变', () => {
        expect(maskProxyUrl('http://127.0.0.1:7890')).toBe('http://127.0.0.1:7890');
    });
});
