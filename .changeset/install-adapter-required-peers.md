---
"onebots": patch
"@onebots/adapter-icqq": patch
---

扩展安装、更新和恢复流程显式安装并严格校验必需 peerDependencies，终端安装确认页展示附带的 SDK 依赖。修正 ICQQ 将运行必需的 @icqqjs/icqq 标记为可选 peer 的声明，避免安装成功后因缺少 SDK 无法启动。
