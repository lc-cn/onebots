import { defineConfig } from 'vitest/config';
import * as path from 'path';

export default defineConfig({
  test: {
    // 测试环境
    environment: 'node',
    
    // 全局测试超时时间
    testTimeout: 30000,
    
    // 启用全局测试 API
    globals: true,
    
    // 测试文件匹配模式
    include: [
      '__tests__/**/*.{test,spec}.{js,ts}',
      'src/**/*.{test,spec}.{js,ts}'
    ],
    
    // 排除的文件
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/lib/**',
      '**/.{idea,git,cache,output,temp}/**'
    ],
    
    // 覆盖率配置
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['src/**/*.ts'],
      exclude: [
        'src/**/*.d.ts',
        'src/**/*.spec.ts',
        'src/**/*.test.ts',
        'src/bin.ts',
        'src/test.ts'
      ]
    },
    
    // 测试报告
    reporters: ['verbose'],
    
    // 监听模式
    watch: false,
    
    // 设置默认环境变量
    env: {
      ONEBOTS_URL: process.env.ONEBOTS_URL || 'http://localhost:6727',
      ONEBOTS_WS_URL: process.env.ONEBOTS_WS_URL || 'ws://localhost:6727',
      PLATFORM: process.env.PLATFORM || 'dingtalk',
      ACCOUNT_ID: process.env.ACCOUNT_ID || 'dingl4hqvwwxewpk6tcn',
      ACCESS_TOKEN: process.env.ACCESS_TOKEN || '',
    },
    
    // 别名设置
    alias: {
      '@': path.resolve(__dirname, './src'),
    }
  }
});
