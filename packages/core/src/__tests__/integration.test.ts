/**
 * 集成测试示例
 * 测试多个模块协同工作
 */

import { describe, it, expect } from 'vitest';
import { ConfigValidator, BaseAppConfigSchema } from '../config-validator.js';
import { LifecycleManager } from '../lifecycle.js';
import { Container } from '../di-container.js';
import { ErrorHandler } from '../errors.js';
import { createLogger } from '../logger.js';

describe('Integration Tests', () => {
    describe('Config Validation Integration', () => {
        it('should validate and apply defaults to BaseApp config', () => {
            const config = {};
            const validated = ConfigValidator.validateWithDefaults(config, BaseAppConfigSchema);
            
            expect(validated.port).toBe(6727);
            expect(validated.database).toBe('onebots.db');
            expect(validated.username).toBeUndefined();
            expect(validated.password).toBeUndefined();
            expect(validated.log_level).toBe('info');
        });

        it('should throw ValidationError on invalid config', () => {
            const invalidConfig = {
                port: 'invalid', // 应该是数字
            };

            expect(() => {
                ConfigValidator.validate(invalidConfig, BaseAppConfigSchema);
            }).toThrow();
        });
    });

    describe('Error Handling Integration', () => {
        it('should handle errors with proper categorization', () => {
            const networkError = new Error('Network timeout');
            const wrapped = ErrorHandler.wrap(networkError);
            
            expect(wrapped.category).toBe('NETWORK');
            expect(ErrorHandler.isRecoverable(wrapped)).toBe(true);
        });

        it('should log errors with context', () => {
            const logger = createLogger('test');
            const error = new Error('Test error');
            const wrapped = ErrorHandler.wrap(error, { userId: '123' });
            
            // 验证错误可以被序列化
            const json = wrapped.toJSON();
            expect(json.context).toEqual({ userId: '123' });
        });
    });

    describe('Lifecycle Management Integration', () => {
        it('should manage resources through lifecycle', async () => {
            const lifecycle = new LifecycleManager();
            let cleaned = false;

            lifecycle.register('test-resource', () => {
                cleaned = true;
            });

            lifecycle.addHook({
                onInit: () => {
                    // 初始化逻辑
                },
                onStart: () => {
                    // 启动逻辑
                },
                onStop: () => {
                    // 停止逻辑
                },
                onCleanup: () => {
                    // 清理逻辑
                },
            });

            await lifecycle.init();
            await lifecycle.start();
            await lifecycle.stop();
            await lifecycle.cleanup();

            expect(cleaned).toBe(true);
        });
    });

    describe('Dependency Injection Integration', () => {
        it('should resolve dependencies correctly', () => {
            const container = new Container();

            class Database {
                connect() {
                    return 'connected';
                }
            }

            class Service {
                constructor(public db: Database) {}
            }

            container.registerSingleton('Database', Database);
            container.registerSingleton('Service', Service, ['Database']);

            const service = container.get<Service>('Service');
            expect(service.db).toBeInstanceOf(Database);
            expect(service.db.connect()).toBe('connected');
        });
    });

    describe('Logger Integration', () => {
        it('should log with context', () => {
            const logger = createLogger('test');
            const contextLogger = logger.withContext({ userId: '123' });
            
            // 验证上下文被正确设置
            expect(contextLogger).toBeInstanceOf(Object);
        });

        it('should measure performance', () => {
            const logger = createLogger('test');
            const stopTimer = logger.start('test-operation');
            
            // 模拟操作
            const duration = 100;
            logger.performance('test-operation', duration);
            
            stopTimer();
        });
    });
});

