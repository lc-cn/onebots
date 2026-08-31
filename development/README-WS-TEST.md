# WebSocket 正向连接测试

用于测试 OneBot V11/V12 和 Milky 协议的 WebSocket 正向连接的实际可行性。

## 安装依赖

```bash
cd development
pnpm install
```

## 使用方法

### 1. 单个协议测试

```bash
# 测试 OneBot V11
node test-ws.js kook zhin onebot v11

# 测试 OneBot V12
node test-ws.js kook zhin onebot v12

# 测试 Milky V1
node test-ws.js kook zhin milky v1
```

### 2. 批量测试所有协议

```bash
# 使用默认参数（kook zhin）
./test-ws-all.sh

# 指定平台和账号
./test-ws-all.sh kook zhin
./test-ws-all.sh qq 3889001676
```

### 3. 使用 npm 脚本

```bash
# 测试默认配置（kook zhin onebot v11）
pnpm test:ws

# 或直接运行
node test-ws.js [platform] [account_id] [protocol] [version]
```

## 参数说明

- `platform`: 平台名称（如 `kook`, `qq`, `wechat`, `discord`）
- `account_id`: 账号ID（配置文件中定义的账号标识）
- `protocol`: 协议名称（`onebot` 或 `milky`）
- `version`: 协议版本（`v11`, `v12`, `v1`）

## 测试内容

测试脚本会执行以下操作：

1. **连接测试**
   - 尝试连接到 WebSocket 服务器
   - 验证连接是否成功建立
   - 检查访问令牌（access_token）验证

2. **事件接收测试**
   - 监听并记录所有收到的事件
   - 显示事件类型和内容
   - 统计事件数量

3. **API 调用测试**
   - 发送 API 请求（如 `get_login_info`, `get_version_info`）
   - 验证 API 响应
   - 测量响应时间

4. **结果汇总**
   - 连接状态
   - 持续时间
   - 收到的事件统计
   - API 测试结果
   - 错误信息

## WebSocket 地址格式

### OneBot V11/V12
```
ws://localhost:6727/{platform}/{account_id}/onebot/{version}?access_token={token}
```

### Milky V1
```
ws://localhost:6727/{platform}/{account_id}/milky/v1/event?access_token={token}
```

## 配置要求

确保 `config.yaml` 中已配置：

1. **协议启用**
   ```yaml
   general:
     onebot.v11:
       use_ws: true
     onebot.v12:
       use_ws: true
     milky.v1:
       use_ws: true
   ```

2. **账号配置**
   ```yaml
   {platform}.{account_id}:
     {protocol}.{version}:
       access_token: 'your_token'  # 可选
   ```

## 测试输出示例

```
============================================================
测试 ONEBOT V11 WebSocket 连接
============================================================
连接地址: ws://localhost:6727/kook/zhin/onebot/v11?access_token=kook_v11_token
开始时间: 2024/1/1 12:00:00

✅ WebSocket 连接成功

📤 开始 API 测试...

📤 [1/3] 获取登录信息 (get_login_info)
📤 [2/3] 获取版本信息 (get_version_info)
📤 [3/3] 获取运行状态 (get_status)

[1000ms] 📨 收到事件: meta_event
    └─ 类型: lifecycle
    └─ 子类型: connect

[1500ms] 📨 收到事件: message
    └─ 消息类型: private
    └─ 发送者: 123456
    └─ 内容: Hello

[2000ms] 📨 收到事件: (API响应)
    └─ ✅ API 响应 (500ms)

============================================================
测试结果汇总
============================================================
连接状态: ✅ 成功
持续时间: 30.00 秒
收到事件数: 5
API 测试数: 3
API 成功数: 3
错误数: 0

收到的事件类型:
  - meta_event: 1
  - message: 2
  - (API响应): 2
============================================================
```

## 注意事项

1. **服务必须运行**: 测试前确保 onebots 服务正在运行
   ```bash
   cd development
   pnpm dev
   ```

2. **账号必须在线**: 确保测试的账号已成功连接并在线

3. **协议必须启用**: 确保配置文件中启用了对应的协议和 WebSocket

4. **访问令牌**: 如果配置了 `access_token`，测试脚本会自动使用

5. **测试时长**: 默认测试时长为 30 秒，可以修改脚本中的超时时间

## 故障排查

### 连接失败

- 检查 onebots 服务是否运行
- 检查端口是否正确（默认 6727）
- 检查配置文件中的协议是否启用

### 认证失败

- 检查 `access_token` 是否正确
- 检查配置文件中是否设置了正确的令牌

### 没有收到事件

- 确保账号已连接并在线
- 尝试发送一条消息触发事件
- 检查协议配置是否正确

### API 调用失败

- 检查 API 名称是否正确
- 检查参数格式是否符合协议规范
- 查看服务器日志获取详细错误信息

