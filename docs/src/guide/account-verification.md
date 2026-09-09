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

原网关已退出且结果无法确定时的显式风险确认恢复尚未完成。未知回执仍会阻止该账号的新验证，浏览器有未确认记录时也会保守禁止新提交。删除浏览器数据、认证文件或操作文件不是恢复办法。旧管理验证入口的退役也仍在进行中，暂不将此分支作为完整架构发布。
