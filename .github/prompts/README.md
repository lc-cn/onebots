# OneBots Copilot Prompts

这些 prompt 文件用于指导 GitHub Copilot 和其他 AI 助手完成特定任务。

## 可用 Prompts

| Prompt | 用途 | 文件 |
|--------|------|------|
| 🔧 **创建适配器** | 创建新的平台适配器 | [new-adapter.prompt.md](./new-adapter.prompt.md) |
| 🐛 **修复 Bug** | 定位和修复问题 | [fix-bug.prompt.md](./fix-bug.prompt.md) |
| 📡 **添加 API** | 为适配器添加新 API | [add-api.prompt.md](./add-api.prompt.md) |
| 🧪 **编写测试** | 编写单元/集成测试 | [write-tests.prompt.md](./write-tests.prompt.md) |
| 🚀 **发布版本** | 准备和发布新版本 | [release.prompt.md](./release.prompt.md) |

## 使用方式

### 在 GitHub Copilot Chat 中

1. 打开相关 prompt 文件
2. 在 Copilot Chat 中 @ 引用文件
3. 描述你的具体需求

### 在 Cursor 中

1. 使用 `@` 符号引用 prompt 文件
2. 或将 prompt 内容复制到对话中

## 示例

```
@.github/prompts/new-adapter.prompt.md

我需要创建一个 Matrix 平台的适配器，
平台名称: matrix
显示名: Matrix
API 文档: https://spec.matrix.org/
```

## 自定义 Prompt

你可以添加自己的 prompt 文件:

1. 在 `.github/prompts/` 创建 `*.prompt.md` 文件
2. 包含:
   - 任务描述
   - 步骤指南
   - 代码模板
   - 检查清单

