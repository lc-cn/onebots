# 账号登录验证

平台要求扫码、验证码或短信确认时，网关会保留待处理挑战，管理端继续可用。安装依赖与配置账号不会代替平台登录，也不会自动发送短信。

## Web 与 TUI

Web 登录后，在“账号登录验证”中刷新请求，按平台提示扫码或填写验证码，再提交。仅当平台声明支持时才显示短信、确认或其他操作。验证码不会写入配置；浏览器只保存用于查询的操作编号。

运行 `onebots ui`，选择“账号登录验证”可完成相同操作。终端输入验证码时不回显；图片验证可以在 Web 查看。提交前终端会显示操作编号，请保留它。

“验证调用已完成”只表示平台 SDK 接受了这次调用，不代表账号已经上线。随后查看账号状态或刷新挑战；平台可能要求下一步验证。

## CLI

```bash
onebots control verification pending --data-dir /path/to/data
onebots control verification execute --stdin --data-dir /path/to/data
onebots control verification operation --request <操作UUID> --data-dir /path/to/data
onebots control verification reconcile --request <操作UUID> --data-dir /path/to/data
```

`execute --stdin` 只接受非终端管道 JSON，字段如下。`challengeId`、`expected` 必须来自当前 `pending` 结果，`operationId` 由调用方生成并在提交前保存。

```json
{
  "operationId": "<本次操作UUID>",
  "challengeId": "<挑战UUID>",
  "expected": {
    "gatewayInstanceId": "<网关实例UUID>",
    "configVersion": "<配置版本>"
  },
  "action": "submit",
  "data": { "code": "<按挑战声明填写>" }
}
```

输入字段以挑战为准，不一定叫 `code`。短信请求使用 `action: "request-sms"` 且不传答案。不要把真实验证码写进 shell 命令、脚本、历史或配置文件；交互使用优先选择 TUI 或 Web。

## 结果未确认时

- `running`：只查询原回执，不再提交。
- `succeeded`：本次验证调用完成，继续检查账号状态。
- `rejected`：本次操作被拒绝，刷新平台挑战并检查配置。
- `unknown` 或连接中断：可能已执行，只查询原操作；不要换编号重新提交或重复发送短信。

回执查询不要求网关在线。Web 只能查询当前设备的回执，本机 CLI 可协助查询其他设备的原操作。更换浏览器不会绕过服务端的账号保护。

查询到 `unknown` 后，可在 Web 点击“核对网关原回执”，或在 TUI 查询后确认核对，也可使用 CLI 的 `reconcile`。这一步只读取原网关已保留的结果，不重新调用平台 SDK，不需要重新输入验证码。

若原网关有确定结果，管理端追加 `resolution`，保留原 `unknown` 和时间；界面显示核对后的结果，解除该记录造成的账号保护。查不到、仍在执行、结果仍未知或原网关已退出，都不能证明操作未执行，因此不会解锁。

若原网关已退出且无法核对结果，先明确停止网关，再决定是否接受风险。Web 在原回执下要求勾选风险提示；TUI 查询原回执后提供二次确认；CLI 使用：

```bash
onebots control verification acknowledge --request <操作UUID> --accept-unknown --data-dir /path/to/data
```

管理服务必须确认网关已完全停止、没有残留受管子进程且无待恢复状态，才会接受；该命令不会替你停止网关。短信可能已经发送、验证可能已经执行，接受风险不会撤销这些效果，也不会再次提交验证码或短信请求。

接受后追加 `acknowledgement.acceptedAt`，原 `status: unknown` 和完成时间不变；界面显示“已接受未知结果”，仅解除这条记录的保护，不表示平台验证成功。确认响应丢失时继续查询原操作编号。之后如需验证，启动网关、刷新新的平台挑战并另行确认。

## 浏览器有编号，但查不到回执

请求可能在服务端受理前断开。查询失败本身不能证明未执行；不要直接删除浏览器记录。

先停止网关，再在该编号下确认“封存未受理编号”。TUI 查询失败后也提供此流程；CLI 使用：

```bash
onebots control verification abandon --request <操作UUID> --confirm --data-dir /path/to/data
onebots control verification abandonment --request <操作UUID> --data-dir /path/to/data
```

服务端确认没有原操作、没有同编号进行中的请求且网关完全停止后，才会持久封存编号。之后迟到的同编号请求会被拒绝，管理服务重启也不会重新受理。已有真实回执不能封存，请按上面的结果恢复流程处理。

浏览器保留编号；封存响应丢失或刷新后，点击“查询原回执”即可同时查询封存结果。查询确认后解除该编号的等待状态。封存不重发验证，也不代表平台从未发生过其他动作。之后启动网关、刷新挑战，再由你决定是否进行新的验证。

删除浏览器数据、认证文件或操作文件不是恢复办法。旧 Web 验证实现和旧 App 后端入口均已移除；验证、回执查询与恢复只通过当前管理服务执行。
