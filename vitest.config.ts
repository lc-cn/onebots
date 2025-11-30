import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',
    
    // 全局测试超时时间
    testTimeout: 30000,
    
    // 启用全局测试 API
    globals: true,
    
    // 测试文件匹配模式 - 扫描所有 packages
    include: [
      'packages/**/src/**/*.{test,spec}.{js,ts}',
      'packages/**/__tests__/**/*.{test,spec}.{js,ts}',
      '__tests__/**/*.{test,spec}.{js,ts}',
      'test/**/*.{test,spec}.{js,ts}'
    ],
    
    // 排除的文件
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/client/**',  // 排除前端项目
      '**/docs/**'     // 排除文档
    ],
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: [
        'packages/*/src/**/*.ts'
      ],
      exclude: [
        'packages/*/src/**/*.d.ts',
        'packages/*/src/**/*.spec.ts',
        'packages/*/src/**/*.test.ts',
        'packages/*/src/bin.ts',
        'packages/client/**',
        'packages/docs/**'
      ],
      // 覆盖率阈值
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0
      }
    },
    
    // 测试报告
    reporters: ['verbose'],
    
    // 监听模式
    watch: false,
    
    // 并行运行测试
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false
      }
    },
    
    // 设置默认环境变量
    env: {
      NODE_ENV: 'test'
    }
  },
  
  resolve: {
    alias: {
      '@onebots/core': resolve(__dirname, './packages/core/src'),
      '@onebots/protocol-onebot-v11': resolve(__dirname, './packages/protocol-onebot-v11/src'),
      '@onebots/protocol-onebot-v12': resolve(__dirname, './packages/protocol-onebot-v12/src'),
      '@onebots/protocol-satori': resolve(__dirname, './packages/protocol-satori/src'),
      '@onebots/protocol-milky-v1': resolve(__dirname, './packages/protocol-milky-v1/src'),
      '@onebots/adapter-wechat': resolve(__dirname, './packages/adapter-wechat/src'),
      'onebots': resolve(__dirname, './packages/onebots/src')
    }
  }
});
