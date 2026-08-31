# 生产就绪功能

OneBots 提供了完整的生产级功能，包括安全性、稳定性和可观测性，确保系统可以在生产环境中稳定运行。

## 安全性功能

### 速率限制 (Rate Limiting)

防止 API 滥用，保护服务器资源。

**特性**:
- 基于时间窗口的速率限制
- 支持自定义键生成（默认使用 IP）
- 自动设置响应头（X-RateLimit-*）
- 集成安全审计日志

**默认配置**: 1 分钟 100 次请求

**自动启用**: 已在 `BaseApp` 中自动集成，无需额外配置

### 安全审计日志

记录所有安全相关事件，满足合规要求。

**特性**:
- 认证成功/失败记录
- 无效令牌记录
- 速率限制触发记录
- 可疑请求记录
- 错误事件记录
- JSON Lines 格式日志
- 按日期分割日志文件

**日志位置**: `{dataDir}/audit/security-audit-{date}.log`

**自动启用**: 已在 `BaseApp` 中自动集成

### 管理面鉴权边界

`/api/*`、根管理 WebSocket `/` 与终端 WebSocket `/api/terminal` 使用同一组动态认证规则。请求可以携带顶层 `access_token`，也可以使用用户名密码登录后签发的会话 token；WebSocket 可通过 `Authorization: Bearer <token>` 或 `?access_token=<token>` 传递。未授权 WebSocket 会在协议升级前返回 HTTP 401，不会先建立连接再关闭，因此无法收到包含完整配置的 `system.sync`。

通过“保存并应用”轮换 `username`、`password` 或 `access_token` 后，HTTP 登录和 WebSocket upgrade 会立即使用新值。已有访问与刷新令牌会全部撤销，已连接的根管理与终端 WebSocket 会以策略违规状态关闭；只修改账号、协议或日志级别不会中断管理会话。

### 令牌管理

完整的令牌生命周期管理。

**特性**:
- 令牌生成和验证
- 令牌过期检查
- 令牌刷新机制
- 自动清理过期令牌
- 令牌撤销功能

**使用示例**:

```typescript
import { initTokenManager, createManagedTokenValidator } from '@onebots/core';

// 初始化令牌管理器
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1小时
    autoRefresh: true,
});

// 创建令牌验证中间件
const tokenValidator = createManagedTokenValidator(tokenManager);
```

### HMAC 签名验证

防止请求篡改和重放攻击。

**特性**:
- 支持多种 HMAC 算法（默认 SHA256）
- 时间安全比较
- 防止重放攻击

## 稳定性功能

### 熔断器模式

防止级联故障，提高系统韧性。

**特性**:
- 三种状态：关闭、开启、半开
- 基于失败次数和错误率的触发
- 自动恢复机制
- 状态监控和统计

**使用示例**:

```typescript
import { CircuitBreaker } from '@onebots/core';

const circuitBreaker = new CircuitBreaker({
    failureThreshold: 5,        // 失败阈值
    resetTimeout: 60000,        // 重置超时（60秒）
    halfOpenMaxCalls: 3,        // 半开状态最大调用数
});

// 使用熔断器执行操作
try {
    const result = await circuitBreaker.execute(async () => {
        return await externalService.call();
    });
} catch (error) {
    // 处理错误
}
```

### 重试机制

自动处理临时故障，提高成功率。

**特性**:
- 指数退避策略
- 随机抖动（防止惊群效应）
- 可配置重试次数和延迟
- 智能错误判断（只重试网络错误）

### 连接池

优化资源使用，提高性能。

**特性**:
- 连接复用
- 最大/最小连接数控制
- 空闲连接自动清理
- 连接验证
- 等待队列管理

## 可观测性

### 性能指标收集

自动收集系统性能指标。

**特性**:
- 计数器（Counter）
- 仪表（Gauge）
- 直方图（Histogram）
- 标签支持
- 时间窗口统计
- 自动清理过期数据

**自动启用**: 已在 `BaseApp` 中自动集成

### Prometheus 指标导出

标准格式的指标导出，可直接接入 Prometheus + Grafana。

**端点**: `GET /metrics`

**指标包括**:
- 应用信息（版本、运行时间）
- 内存使用（RSS、堆内存）
- 适配器、账号和协议出口状态
- HTTP 请求指标（请求数、响应时间、错误率）

**使用示例**:

```bash
# 访问指标端点
curl http://localhost:6727/metrics

# 配置 Prometheus
scrape_configs:
  - job_name: 'onebots'
    static_configs:
      - targets: ['localhost:6727']
```

### 健康检查端点

支持 Kubernetes 部署的探针。

**端点**:
- `GET /health` - 存活探针（liveness probe）
- `GET /ready` - 就绪探针（readiness probe）

**功能**:
- `/health`: 基础健康检查
- `/ready`: 检查服务、账号和每个协议出口是否就绪

`/ready` 的 `summary` 同时给出账号与协议实例总数、在线/就绪数量以及 `accounts_without_protocols`；每个平台也会列出缺少协议出口的账号数，以及协议的 `ready`、`unavailable` 与 `total`。即使平台账号已经 online，只要任一协议 `start()` 失败或任一账号没有协议出口，端点仍会返回 HTTP 503。响应中的 `config.status` 与 `config.in_sync` 还会证明磁盘配置是否就是当前运行版本；外部修改、不可读文件或等待重启的宿主配置会撤销 readiness。首次启动尚未配置账号时，管理面保持 HTTP 200 以便继续配置，但响应包含 `configured: false`，doctor 会把它明确标为警告。

热重载配置期间 HTTP 存活探针继续返回成功，但 `/ready` 会立即返回 HTTP 503 并声明 `reloading: true`，直到新账号与协议出口完成启动或旧配置完成回滚。并发热重载会被拒绝，防止两次配置切换交错覆盖。Prometheus 的 `onebots_reloading` 可用于记录和告警持续时间异常的重载。

部署或更新后可运行 `onebots doctor --json` 作为自动化门禁。配置端口可连接时，无论网关以前台、Docker 还是托管服务方式运行，doctor 都会同时探测这两个端点；非 2xx、非 JSON、`status` 不是 `ok` 或 `ready` 不是 `true` 都会让检查失败。`/ready` 失败时，报告会列出在线账号、就绪协议数量、对应的未就绪平台以及缺少协议出口的账号，避免只看到一个没有上下文的 HTTP 503。Prometheus 可通过 `onebots_accounts_without_protocols` 为这类配置缺口设置告警。

账号管理摘要还会为每个协议出口返回 `name`、`version`、`path` 和 `lifecycleStatus`。机器人管理页会分别显示等待启动、启动中、就绪、停止中、已停止或失败，不再用账号 online 状态掩盖某个协议出口的启动失败。doctor 在验证合法管理凭据后会读取同一份受保护的运行态，直接报告 `平台.账号/协议.版本`；公开的 `/ready` 仍只返回平台级聚合，不暴露账号标识。

同一次在线诊断还会验证管理面安全边界：匿名请求必须从 `/api/auth/me` 得到 HTTP 401，匿名根 WebSocket 必须在升级前得到 HTTP 401；随后使用配置中的 `access_token`（也支持 `ONEBOTS_ACCESS_TOKEN`）或用户名密码确认合法 HTTP 请求和 WebSocket 握手仍然可用。用户名密码探测生成的临时会话会立即注销。若自定义宿主只在内存中提供凭据、doctor 无法从配置或环境取得，匿名拒绝仍会验证，两项合法凭据探测则标为警告。

doctor 还会实际加载服务选用的插件，并使用它们注册的 Schema 校验完整账号和协议配置。每项成功结果会包含实际解析到的包名与版本，`plugin-selection` 检查会逐类别记录插件来自 CLI、配置文件还是服务定义，并给出模块解析目录。没有 `plugins` 的旧配置仍应传入与启动命令相同的 `-r` / `-p` 参数。

默认诊断已安装服务时，服务定义继续是实际运行契约。显式传入与服务定义不同的 `-c` 则表示验证一份独立候选配置：doctor 使用候选文件自己的插件默认值，不会把旧服务的插件混入结果，也不会因路径不同判定服务定义失效；即使同时传入 `--fix`，也不会改写那份无关的服务定义。这使发布流水线可以在切换服务前可靠验证下一版配置。

受保护的 `GET /api/system` 在 `plugins` 字段返回当前进程已通过入口加载和注册契约校验的适配器、协议及其包名、版本、真实入口路径；Web 管理端的「系统信息 → 运行时插件」展示同一清单。该信息来自正在运行的进程，可用于确认更新后是否已经重启到预期版本，也能区分同名插件实际来自哪个安装位置。管理 WebSocket 的初始 `system.sync` 同步相同数据。

setup、Web 管理端与运行时账号操作通过同一原子写入边界保存配置：新内容先在配置目录完成写入与同步，再替换正式文件，避免进程退出留下半截 YAML。Web 保存随后立即热重载账号与协议；应用失败会恢复磁盘和运行态的上一版本，宿主参数变更则返回需要重启的字段。更新已有配置时会把紧邻的上一版本保存在 `<config>.bak`；新配置默认权限为 `0600`，已有配置继续沿用原权限。恢复前仍应先用 `onebots doctor` 校验备份内容。

进程会在启动、每次成功热重载及账号配置落盘后保留配置文件的不可逆摘要。受保护的 `GET /api/system` 通过 `configState` 字段与 Web「系统信息 → 配置状态」只公开 `in_sync`、`drifted` 或 `unavailable` 及最近应用时间，不公开摘要或配置内容。若配置被外部编辑、挂载替换，或者 Web 保存的宿主字段仍等待重启，状态会保持 `drifted`；成功重新加载或重启后才恢复 `in_sync`。同一状态会投影到公开 `/ready`，不同步时返回 HTTP 503，并通过 `onebots_config_in_sync` 指标暴露为 `0`；doctor 会把漂移和文件不可读分别报告为可操作原因。管理 WebSocket 的初始 `system.sync` 也携带同一状态。

在 POSIX 系统上，doctor 会分别检查正式配置与 `.bak` 的权限。`0600` 视为私有；`0640` 等仅允许同组读取的模式会给出警告但不自动修改，以兼容服务账号共享；其他用户可访问或同组用户可修改会使检查失败。显式使用 `--fix` 时，这类高风险权限会收紧为 `0600`，JSON 报告中的 `fixed` 字段可供部署脚本留痕。

“已加载”要求插件入口完成初始化，并注册 CLI 名称对应的工厂与配置 Schema。可导入但漏注册、名称不匹配或仅注册工厂而缺少 Schema 的插件会被 doctor 和所有服务预检判为错误，而不会延迟到启动后或 Web 管理端才暴露。

插件入口存在但初始化失败时，doctor 会保留底层首行错误，例如重复注册冲突或缺少运行时依赖，而不是只报告笼统的“初始化失败”。这类错误应先修复插件安装或命名冲突，再重新执行诊断。

使用 `onebots install -c config.yaml -r <adapter> -p <protocol>` 安装守护服务时，同一套插件加载与配置校验会在系统服务定义写入前执行。仅暴露 `exports.import` 的插件、顶层 `await`、Schema 校验和初始化异常都按前台启动语义处理；预检失败不会留下一个必然无法启动的服务。安装成功仍不会立即启动，可在审阅服务定义后执行 `onebots start`。

`onebots start` 与 `onebots restart` 还会读取已保存的服务定义，以安装时的 `workingDirectory` 解析插件，并重新校验当前配置。这能捕获安装后被删除或损坏的插件与配置；启动预检失败时不会请求操作系统启动服务，重启预检失败时也不会先停止现有实例。

服务启动后，`onebots status` 会同时显示进程管理器状态以及 `/health`、`/ready` 的语义结果。输出会区分“运行中，已就绪”“运行中，待配置”和“运行中，不可用”；已安装但未运行或任一探针失败时退出码为 `1`，服务未安装时为 `2`。因此 CI/CD 可以直接以 `onebots status` 作为轻量部署门禁，需要完整配置和插件诊断时再使用 `onebots doctor --json`。

`onebots update` 默认读取当前 `config.yaml` 的 `plugins` 选择，因此通过 Web 扩展中心后装的适配器和协议也会进入版本检查与更新；显式 `-r` / `-p` 仍可按类别覆盖配置，旧配置没有 `plugins` 时才回退到服务安装时的快照。包管理器更新后，会从服务的 `workingDirectory` 启动更新后的 CLI 子进程，以同一插件列表执行无连接预检。只有新运行环境成功加载全部插件并通过配置校验，才会改写服务定义并按确认结果重启。预检失败时不会停止当前实例，也不会替换服务定义；由于依赖文件已经更新，现有进程可继续使用内存中的旧代码，但下次启动前必须根据错误修复依赖或使用 npm/pnpm 回退版本，然后重新执行预检或更新。

**Kubernetes 配置示例**:

```yaml
livenessProbe:
  httpGet:
    path: /health
    port: 6727
  initialDelaySeconds: 30
  periodSeconds: 10

readinessProbe:
  httpGet:
    path: /ready
    port: 6727
  initialDelaySeconds: 5
  periodSeconds: 5
```

## 自动集成

所有生产就绪功能已在 `BaseApp` 中自动集成，无需额外配置即可使用。

### 自动启用的功能

1. **速率限制** - 默认 1 分钟 100 次请求
2. **安全审计日志** - 自动记录到 `{dataDir}/audit/`
3. **性能指标收集** - 自动收集所有 HTTP 请求指标
4. **健康检查端点** - `/health`, `/ready`, `/metrics`

### 可选配置

```typescript
import { App } from 'onebots';
import { initTokenManager } from '@onebots/core';

// 初始化令牌管理器（可选）
const tokenManager = initTokenManager({
    defaultExpiration: 3600000, // 1小时
    autoRefresh: true,
});

const app = new App({
    port: 6727,
    log_level: 'info',
});

await app.start();
```

## 注意事项

1. **速率限制存储**: 当前使用内存存储，生产环境建议使用 Redis
2. **安全审计日志**: 日志文件会按日期分割，建议定期归档
3. **性能指标**: 默认保留最近 1000 个样本，可根据需要调整
4. **令牌管理**: 令牌管理器需要手动初始化才能使用

## 后续优化建议

1. **Redis 支持**: 将速率限制和安全审计日志存储到 Redis
2. **分布式追踪**: 集成 OpenTelemetry 或 Jaeger
3. **告警系统**: 基于指标设置告警规则
4. **性能优化**: 添加缓存层和连接池优化

## 相关文档

- [快速开始](/guide/start)
- [配置指南](/config/global)
- [架构说明](/guide/architecture)
