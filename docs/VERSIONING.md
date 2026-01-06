# 文档版本管理指南

OneBots 文档支持多版本管理，允许用户访问不同版本的文档。

## 工作原理

1. **当前版本**: 主分支的文档始终是最新版本
2. **历史版本**: 通过 Git 标签管理历史版本的文档
3. **版本选择器**: 在导航栏提供版本选择下拉菜单
4. **自动同步**: 通过脚本自动从 Git 标签同步版本列表
5. **自动部署**: GitHub Actions 自动构建和部署所有版本

## 使用方法

### 1. 同步版本列表（推荐）

自动从 Git 标签同步版本到配置：

```bash
cd docs
pnpm sync-versions
```

这会：
- 读取所有 Git 标签（格式: `vX.X.X`）
- 自动更新 `version-selector.ts` 配置
- 保留最近 10 个版本

### 2. 手动配置版本

编辑 `docs/.vitepress/version-selector.ts`，手动添加版本：

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
    },
    // ... 其他版本
];
```

### 3. 自动部署工作流

GitHub Actions 工作流会自动：

1. **检测版本**: 读取所有 Git 标签（最近 10 个）
2. **构建文档**: 
   - 当前版本：从主分支构建，并自动同步版本列表
   - 历史版本：从对应 Git 标签构建（并行执行）
3. **合并部署**: 将所有版本合并到同一个站点
   - 当前版本：部署到 `/`
   - 历史版本：部署到 `/vX.X.X/`

#### 触发条件

- **推送主分支**: 当 `docs/` 目录有变更时自动触发
- **创建标签**: 当创建新的版本标签时（通过 `deploy_docs_on_tag.yml`）
- **手动触发**: 在 GitHub Actions 中手动运行，可选择强制重建所有版本

#### 工作流步骤

1. **获取版本**: 读取所有 Git 标签（最近 10 个）
2. **检查缺失**: 确定需要构建的版本（排除当前版本）
3. **并行构建**: 
   - 当前版本（主分支，自动同步版本列表）
   - 历史版本（从 Git 标签 checkout，并行执行）
4. **合并部署**: 将所有版本合并并部署到 GitHub Pages

## 部署结构

部署后的目录结构：

```
/
├── index.html          # 当前版本（最新）
├── guide/              # 当前版本文档
├── config/             # 当前版本配置
├── v0.5.0/             # v0.5.0 版本文档
│   ├── index.html
│   ├── guide/
│   └── config/
├── v0.4.0/             # v0.4.0 版本文档
│   └── ...
└── versions.html       # 版本索引页面
```

## 版本管理命令

### 同步版本列表

```bash
pnpm docs:sync-versions
```

这会自动从 Git 标签读取版本并更新配置。

### 查看版本列表

```bash
git tag -l 'v*' | sort -V
```

## 最佳实践

1. **版本命名**: 使用语义化版本号 (SemVer)
2. **保留策略**: 建议保留最近 10 个主要版本
3. **自动同步**: 发布新版本后运行 `pnpm docs:sync-versions`（工作流会自动执行）
4. **文档同步**: 确保版本快照与代码版本一致

## 注意事项

1. **存储空间**: 每个版本会占用一定空间，定期清理旧版本
2. **构建时间**: 多版本构建会增加 CI/CD 时间（并行构建可缓解）
3. **链接更新**: 确保版本选择器中的链接正确指向部署路径
4. **Git 标签**: 确保每个版本都有对应的 Git 标签

## 工作流配置

### 自动触发

- **主分支推送**: 当 `docs/` 目录变更时自动触发
- **版本标签**: 创建新标签时自动触发（`deploy_docs_on_tag.yml`）

### 手动触发

在 GitHub Actions 中可以：
- 手动运行工作流
- 选择"强制重建所有版本"选项

### 构建策略

- **当前版本**: 总是从主分支构建，并自动同步版本列表
- **历史版本**: 从对应 Git 标签构建（最多 10 个）
- **并行构建**: 历史版本并行构建，提高效率
- **智能检测**: 自动过滤当前版本，只构建历史版本

## 相关文件

- `docs/.vitepress/version-selector.ts` - 版本选择器配置
- `docs/.vitepress/plugins/versioning.ts` - 版本管理插件
- `docs/scripts/sync-versions.js` - 版本同步脚本
- `.github/workflows/deploy_docs.yml` - 多版本部署工作流
- `.github/workflows/deploy_docs_on_tag.yml` - 标签触发部署工作流
