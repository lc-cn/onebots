/**
 * 依赖注入容器测试
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { Container } from '../di-container.js';

describe('Dependency Injection Container', () => {
    let container: Container;

    beforeEach(() => {
        container = new Container();
    });

    describe('Service Registration', () => {
        it('should register and retrieve singleton service', () => {
            class TestService {
                value = 1;
            }

            container.registerSingleton('TestService', TestService);
            const instance1 = container.get<TestService>('TestService');
            const instance2 = container.get<TestService>('TestService');

            expect(instance1).toBe(instance2);
            expect(instance1).toBeInstanceOf(TestService);
        });

        it('should register and retrieve transient service', () => {
            class TestService {
                value = Math.random();
            }

            container.registerTransient('TestService', TestService);
            const instance1 = container.get<TestService>('TestService');
            const instance2 = container.get<TestService>('TestService');

            expect(instance1).not.toBe(instance2);
            expect(instance1).toBeInstanceOf(TestService);
        });

        it('should register factory function', () => {
            const factory = () => ({ value: 42 });
            container.registerSingleton('TestService', factory);
            const instance = container.get<{ value: number }>('TestService');

            expect(instance.value).toBe(42);
        });

        it('should check if service exists', () => {
            container.registerSingleton('TestService', class {});
            expect(container.has('TestService')).toBe(true);
            expect(container.has('NonExistent')).toBe(false);
        });
    });

    describe('Dependency Resolution', () => {
        it('should resolve dependencies', () => {
            class Dependency {
                value = 'dependency';
            }

            class Service {
                constructor(public dep: Dependency) {}
            }

            container.registerSingleton('Dependency', Dependency);
            container.registerSingleton('Service', Service, ['Dependency']);

            const service = container.get<Service>('Service');
            expect(service.dep).toBeInstanceOf(Dependency);
            expect(service.dep.value).toBe('dependency');
        });

        it('should resolve multiple dependencies', () => {
            class Dep1 {
                value = 1;
            }

            class Dep2 {
                value = 2;
            }

            class Service {
                constructor(public dep1: Dep1, public dep2: Dep2) {}
            }

            container.registerSingleton('Dep1', Dep1);
            container.registerSingleton('Dep2', Dep2);
            container.registerSingleton('Service', Service, ['Dep1', 'Dep2']);

            const service = container.get<Service>('Service');
            expect(service.dep1.value).toBe(1);
            expect(service.dep2.value).toBe(2);
        });
    });

    describe('Error Handling', () => {
        it('should throw error for unregistered service', () => {
            expect(() => {
                container.get('NonExistent');
            }).toThrow('Service not found: NonExistent');
        });
    });

    describe('Container Management', () => {
        it('should clear all services', () => {
            container.registerSingleton('Service1', class {});
            container.registerSingleton('Service2', class {});
            expect(container.has('Service1')).toBe(true);
            expect(container.has('Service2')).toBe(true);

            container.clear();
            expect(container.has('Service1')).toBe(false);
            expect(container.has('Service2')).toBe(false);
        });

        it('should remove specific service', () => {
            container.registerSingleton('Service1', class {});
            container.registerSingleton('Service2', class {});

            expect(container.remove('Service1')).toBe(true);
            expect(container.has('Service1')).toBe(false);
            expect(container.has('Service2')).toBe(true);
        });
    });
});

