# 鉴权与心跳逐条检查清单

与 [PROTOCOL_AUTH_HEARTBEAT.md](./PROTOCOL_AUTH_HEARTBEAT.md) 配套，用于逐条完成与回归。完成一项后请将 `- [ ]` 改为 `- [x]`。

---

## 阶段一：测试可执行性与结果记录

- [x] **1.1** 运行鉴权与心跳相关测试并记录结果（Test Files 21 passed, Tests 231 passed）
- [x] **1.2** 修复测试代码中的失败与隐患（OneBot/Milky http-client 异常时返回稳定 data；无新增失败）

---

## 阶段二：测试与协议文档逐条对照

### OneBot 11

- [x] **OB11-1** HTTP 鉴权测试与文档一致（无 token/错误 token/正确 token；Query 与 Header）
- [x] **OB11-2** WS 鉴权测试在连接阶段验证 401
- [x] **OB11-3** WebHook 鉴权/签名与文档一致
- [x] **OB11-4** 反向 WS 鉴权服务端模拟 401 与 token 校验与文档一致
- [x] **OB11-5** 心跳断言包含 interval、status，类型/单位与文档一致

### OneBot 12

- [x] **OB12-1** 若增加 OB12 HTTP 鉴权测试则覆盖 Header 优先（实现已修正，见阶段三）
- [x] **OB12-2** 反向 WS 请求头断言包含必须头及鉴权方式
- [x] **OB12-3** Webhook 请求头断言与文档一致
- [x] **OB12-4** 心跳只断言 interval，不要求 status

### Milky

- [x] **M-1** HTTP 鉴权 401、415、404 及空 body `{}` 与文档一致
- [x] **M-2** SSE/WS 鉴权两种方式均有覆盖

### Satori

- [x] **S-1** HTTP 鉴权与响应格式（401/403、data/message）及 data 防护

---

## 阶段三：实现与协议文档逐条对照

### OneBot 11 实现

- [x] **OB11-impl-1** HTTP 鉴权顺序（OB11 标准未强制 Header 优先，当前 Query 优先保留）
- [x] **OB11-impl-2** 鉴权失败返回 401，响应体 retcode 1403
- [x] **OB11-impl-3** 心跳间隔单位：配置为秒，代码已改为 `intervalMs = 秒 * 1000`

### OneBot 12 实现

- [x] **OB12-impl-1** HTTP/WS 鉴权顺序改为先 Authorization 头再 access_token Query
- [x] **OB12-impl-2** 鉴权失败 401 与响应格式
- [x] **OB12-impl-3** 心跳仅 interval(ms)，无 status
- [x] **OB12-impl-4** 心跳间隔单位：配置为秒，代码已改为 `intervalMs = 秒 * 1000`

### Milky 实现

- [x] **M-impl-1** HTTP 鉴权 Bearer 优先再 Query；401
- [x] **M-impl-2** 不支持的 Content-Type 返回 415

### Satori 实现

- [x] **S-impl-1** 未授权返回 401 及 { message } 格式

---

## 阶段四：清单文档与回归

- [x] **4.1** 新增可勾选清单（本文件）
- [x] **4.2** 在 __tests__/README.md 中增加「鉴权与心跳逐条清单」链接
- [x] **4.3** 完成所有项后再次运行测试，确认通过或预期跳过

---

**最后回归命令**：`pnpm test __tests__/onebot __tests__/milky __tests__/satori -- --run`
