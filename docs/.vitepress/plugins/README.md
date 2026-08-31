# VitePress 版本管理插件

这是一个为 VitePress 提供多版本文档管理功能的插件。

## 功能特性

- ✅ 自动在导航栏添加版本选择器
- ✅ 支持多个历史版本
- ✅ 自动识别当前版本
- ✅ 支持中英文多语言
- ✅ 可配置版本选择器位置

## 使用方法

### 1. 配置版本列表

在 `version-selector.ts` 中配置版本：

```typescript
export const versions: VersionInfo[] = [
    {
        version: '0.6.0',
        label: 'v0.6.0 (最新)',
        link: '/',
        isCurrent: true
    },
    {
        version: '0.5.0',
        label: 'v0.5.0',
        link: '/v0.5.0/',
        isCurrent: false
    }
];
```

### 2. 在配置中使用插件

```typescript
import { withVersioning } from "./plugins/versioning.js";

const versioningOptions = {
    versions: versions,
    currentVersion: getCurrentVersion()?.version,
    position: 'end' // 'start' | 'end' | number
};

export default withMermaid(
    withVersioning(baseConfig, versioningOptions)
);
```

## API

### `withVersioning(config, options)`

包装 VitePress 配置，自动添加版本选择器到导航栏。

**参数**:
- `config`: VitePress 配置对象
- `options`: 版本管理选项
  - `versions`: 版本列表
  - `currentVersion`: 当前版本号（可选）
  - `position`: 版本选择器位置（'start' | 'end' | number）

**返回**: 修改后的 VitePress 配置

## 工作原理

1. 插件读取版本配置
2. 自动识别当前版本和其他版本
3. 在导航栏中插入版本选择器
4. 支持多语言配置（自动处理所有 locale）

## 注意事项

- 版本选择器会自动添加到所有 locale 的导航栏
- 确保版本路径与实际部署路径匹配
- 建议保留最近 3-5 个主要版本

