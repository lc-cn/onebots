# 1Panel 部署 OneBots

本目录提供与 [1Panel 应用商店](https://github.com/1Panel-dev/appstore) 相同布局的 **`onebots`** 应用描述，便于一键安装或向官方商店提交 PR。

## 目录说明

```
onebots/
├── data.yml              # 应用元数据（名称、标签、架构等）
├── logo.png              # 列表图标
├── README.md             # 应用商店内说明
└── 0.5.0/                # 与镜像版本对应的目录（发新版时复制并改镜像标签）
    ├── data.yml          # 安装表单（端口等）
    └── docker-compose.yml
```

发新版时：新增目录 `x.y.z/`，将 `docker-compose.yml` 中镜像改为 `ghcr.io/<owner>/onebots:x.y.z`（或与 CI 实际打的 tag 一致，例如 `master`）。

## 在 1Panel 中使用

### 方式 A：本地 Compose（最快）

1. 打开 **容器 → Compose → 创建编排**
2. 将 `onebots/0.5.0/docker-compose.yml` 内容粘贴进编辑器（或选择本仓库目录下的该文件）
3. 在 1Panel 中设置 **端口**（映射到容器 **6727**）与 **数据卷**（挂载到容器 **`/data`**，用于配置、管理状态、运行版本与业务数据）
4. 网络选用 **`1panel-network`**（与面板其他应用一致；若不存在可改为 `bridge` 并去掉 `external: true`）

镜像默认：`ghcr.io/lc-cn/onebots:0.5.0`。若该 tag 尚未推送，可改为 `ghcr.io/lc-cn/onebots:master`（以你仓库 CI 实际产物为准）。

### 方式 B：第三方应用商店源

1. 将本仓库（或仅 `deploy/1panel/`）托管为 Git 仓库
2. 在 1Panel **应用商店 → 设置** 中添加该源（需符合 1Panel 对应用源目录结构的要求）
3. 在商店中安装 **OneBots**

### 方式 C：合并进官方 appstore

向 [1Panel-dev/appstore](https://github.com/1Panel-dev/appstore) 提交 PR，将 `onebots/` 复制到其 `apps/onebots/`，并遵循官方贡献说明（镜像需公开可拉取、维护活跃度等）。

## 说明

- 容器只托管常驻管理服务，独立网关由管理服务启停。停止网关不会关闭 Web 控制台。
- 空数据卷不预填账号、平台、协议或框架。启动后在宿主终端执行 `docker exec --user 1000:1000 onebots node /app/packages/onebots/lib/bin.js auth bootstrap --data-dir /data` 获取一次性设备码，再访问映射后的 6727 端口完成配对。
- Web、TUI 与 CLI 共用同一套安装、配置、启停和恢复流程。先选择依赖并验证候选运行版本，再显式激活和配置账号；安装依赖不会自动连接平台或开放协议。
- 不要给容器增加旧 `-r/-p/-t` 参数，不要在活动目录运行 `npm install`，也不要挂载 Docker socket。私有 registry 授权只交给单次安装操作。
- 版本目录和镜像标签必须与 CI 实际发布产物一致；示例中的 `0.5.0` 只是现有 1Panel 目录布局，不表示新架构已随该标签发布。
