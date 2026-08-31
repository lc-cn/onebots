# 发布新版本

你正在准备 OneBots 的新版本发布。

## 发布流程

### 1. 创建 Changeset

```bash
pnpm changeset
```

选择要发布的包，版本类型必须全部选择 `patch` (0.0.x)。这是项目的硬性发布策略，功能新增和破坏性变更也不得使用 `minor` 或 `major`。

### 2. Changeset 文件格式

```markdown
---
"@onebots/core": patch
"@onebots/adapter-xxx": patch
---

## 更新内容

### @onebots/core

- 新增 xxx 功能
- 修复 xxx 问题

### @onebots/adapter-xxx

- 修复 xxx bug
```

### 3. 验证构建

```bash
# 清理并重新构建
pnpm clean
pnpm build

# 运行测试
pnpm test

# 检查 lint
pnpm lint
```

### 4. 推送代码

```bash
git add .
git commit -m "chore: add changeset for vX.X.X"
git push origin master
```

### 5. 等待 CI（`release.yml` / Changesets）

1. push 到 `master` 后，`changesets/action` 检测到 `.changeset` 时自动创建 **Version PR**
2. 审核并合并该 PR（更新版本号与 CHANGELOG）
3. 合并再次触发 `release.yml`，在无待处理 changeset 时执行 **`pnpm pub`** 发布到 npm，并打 tag、创建 GitHub Release

## 版本号规范

所有包只允许发布 Patch（例如 1.0.0 → 1.0.1）。这是项目发布约定，创建和审查 changeset 时必须遵守。

版本来源只认 `.changeset/*.md` 和 Changesets 生成的 Version PR；commit message 仅用于 Git 历史可读性，不参与版本级别推导。

## 包发布顺序

1. `@onebots/core` - 核心包优先
2. `onebots` - 主包
3. `@onebots/protocol-*` - 协议包
4. `@onebots/adapter-*` - 适配器
5. `@imhelper/*` - 客户端 SDK

## 检查清单

- [ ] 所有更改都有对应的 changeset
- [ ] 版本号符合语义化版本
- [ ] 测试全部通过
- [ ] 文档已更新
- [ ] CHANGELOG 已生成
- [ ] 新包已添加到 changeset

## 常见问题

### 忘记添加某个包

```bash
# 编辑现有 changeset
vim .changeset/xxx.md
# 添加包名和版本类型
```

### 需要紧急修复

```bash
# 只发布 patch 版本
pnpm changeset
# 选择 patch
```

### 撤销发布

npm 包发布后 72 小时内可以撤销:

```bash
npm unpublish @onebots/xxx@version
```
