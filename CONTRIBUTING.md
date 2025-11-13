# 贡献指南

感谢您对 OneBots 项目的关注！我们欢迎各种形式的贡献。

## 开发环境要求

- Node.js >= 18.0.0
- npm >= 9.0.0

我们建议使用 [nvm](https://github.com/nvm-sh/nvm) 管理 Node.js 版本：

```bash
nvm use
```

## 开发流程

### 1. Fork 并克隆仓库

```bash
git clone https://github.com/YOUR_USERNAME/onebots.git
cd onebots
```

### 2. 安装依赖

```bash
npm install
```

### 3. 开发

```bash
npm run dev
```

### 4. 代码规范

项目使用 ESLint 和 Prettier 保证代码质量：

```bash
# 检查代码规范
npm run lint

# 自动修复
npm run lint:fix

# 类型检查
npm run type-check
```

### 5. 构建

```bash
npm run build
```

### 6. 提交代码

项目使用 Husky 和 lint-staged，提交代码时会自动运行代码检查。

提交信息请遵循 [Conventional Commits](https://www.conventionalcommits.org/) 规范：

- `feat:` 新功能
- `fix:` 修复 bug
- `docs:` 文档更新
- `style:` 代码格式调整
- `refactor:` 重构
- `perf:` 性能优化
- `test:` 测试相关
- `chore:` 构建/工具链相关

### 7. 提交 Pull Request

1. 确保代码通过所有检查
2. 添加清晰的 PR 描述
3. 关联相关的 Issue

## 项目结构

```
onebots/
├── src/              # 源代码
│   ├── adapters/     # 适配器实现
│   ├── server/       # 服务器相关
│   ├── service/      # OneBot 服务
│   └── ...
├── docs/             # 文档
├── client/           # 前端代码
└── lib/              # 编译输出
```

## 注意事项

1. 保持代码简洁易读
2. 为新功能编写文档
3. 确保向后兼容性
4. 遵循现有的代码风格
5. 测试你的改动

## 遇到问题？

如果您在开发过程中遇到任何问题，欢迎：

- 提交 [Issue](https://github.com/lc-cn/onebots/issues)
- 加入 QQ 群：860669870

再次感谢您的贡献！
