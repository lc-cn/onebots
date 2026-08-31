# IMHelper 开发测试模块

这是一个用于测试 IMHelper 及其协议和适配器的开发测试模块。

## 安装依赖

```bash
pnpm install
```

## 运行测试

### 服务器端开发

```bash
# 运行服务器（开发环境）
pnpm dev
```

### 客户端SDK开发

```bash
# 运行客户端SDK开发测试（支持文件监听和自动重载）
pnpm client:dev
```

客户端SDK开发测试脚本支持通过环境变量配置：

```bash
# 使用环境变量配置
PLATFORM=kook \
ACCOUNT_ID=zhin \
PROTOCOL=onebot \
VERSION=v11 \
RECEIVE_MODE=ws \
BASE_URL=http://localhost:6727 \
ACCESS_TOKEN=your_token \
pnpm client:dev
```

环境变量说明：
- `PLATFORM` - 平台名称（默认: `kook`）
- `ACCOUNT_ID` - 账号ID（默认: `zhin`）
- `PROTOCOL` - 协议名称（默认: `onebot`）
- `VERSION` - 协议版本（默认: `v11`，支持 `v11`、`v12`）
- `RECEIVE_MODE` - 接收模式（默认: `ws`，支持 `ws`、`wss`、`webhook`、`sse`）
- `BASE_URL` - 服务器地址（默认: `http://localhost:6727`）
- `ACCESS_TOKEN` - 访问令牌（可选）

### WebSocket 连接测试

```bash
# 测试 WebSocket 连接
pnpm test:ws
```

## 包含的依赖

### 服务器端
- `onebots` - 核心应用
- `@onebots/protocol-milky-v1` - Milky V1 协议
- `@onebots/protocol-satori-v1` - Satori V1 协议
- `@onebots/protocol-onebot-v11` - OneBot V11 协议
- `@onebots/protocol-onebot-v12` - OneBot V12 协议
- `@onebots/adapter-qq` - QQ适配器
- `@onebots/adapter-kook` - Kook适配器
- `@onebots/adapter-discord` - Discord适配器
- `@onebots/adapter-wechat` - 微信适配器

### 客户端SDK
- `imhelper` - 客户端SDK核心
- `@imhelper/onebot-v11` - OneBot V11 客户端SDK
- `@imhelper/onebot-v12` - OneBot V12 客户端SDK
