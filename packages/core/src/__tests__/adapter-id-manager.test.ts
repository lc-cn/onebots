/**
 * 适配器 ID 管理单元测试
 */
import { describe, it, expect } from 'vitest';
import { buildTableName } from '../adapter-id-manager.js';

describe('buildTableName', () => {
    it('普通平台名保持不变', () => {
        expect(buildTableName('qq')).toBe('id_map_qq');
        expect(buildTableName('wechat')).toBe('id_map_wechat');
        expect(buildTableName('discord')).toBe('id_map_discord');
    });

    it('含连字符的平台名转为下划线', () => {
        expect(buildTableName('wechat-clawbot')).toBe('id_map_wechat_clawbot');
        expect(buildTableName('wecom-kf')).toBe('id_map_wecom_kf');
    });

    it('特殊字符被过滤', () => {
        expect(buildTableName('test.platform')).toBe('id_map_test_platform');
    });
});
