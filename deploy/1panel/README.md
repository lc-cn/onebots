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
3. 在 1Panel 中设置 **端口**（映射到容器 **6727**）与 **数据卷**（挂载到容器 **`/data`**，用于 `config.yaml`、数据库等）
4. 网络选用 **`1panel-network`**（与面板其他应用一致；若不存在可改为 `bridge` 并去掉 `external: true`）

镜像默认：`ghcr.io/lc-cn/onebots:0.5.0`。若该 tag 尚未推送，可改为 `ghcr.io/lc-cn/onebots:master`（以你仓库 CI 实际产物为准）。

### 方式 B：第三方应用商店源

1. 将本仓库（或仅 `deploy/1panel/`）托管为 Git 仓库
2. 在 1Panel **应用商店 → 设置** 中添加该源（需符合 1Panel 对应用源目录结构的要求）
3. 在商店中安装 **OneBots**

### 方式 C：合并进官方 appstore

向 [1Panel-dev/appstore](https://github.com/1Panel-dev/appstore) 提交 PR，将 `onebots/` 复制到其 `apps/onebots/`，并遵循官方贡献说明（镜像需公开可拉取、维护活跃度等）。

## 说明

- 首次启动容器会在 **`/data`** 下自动生成 **`config.yaml`**（由镜像 entrypoint 从示例复制），请在面板或 SSH 中编辑后重启容器。
- 默认 CMD 已注册多类适配器与协议；可按需改为挂载自定义命令或自建镜像。
