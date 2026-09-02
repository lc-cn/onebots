# IRCv3

IRCv3 适配器面向 Modern IRC 与已稳定的 IRCv3 扩展。主动 TCP/TLS、宿主已有 socket 和 `ingest(rawEvent)` 汇入同一个 `Ircv3Client` 会话状态机，不通过私有监听端口绕开 OneBots Host。

## 资源与消息映射

- IRC channel → canonical `group` / `channel`；nickname/account → `user`；
- channel PRIVMSG/NOTICE → `message_type: channel`，对 bot nickname 的消息 → `direct`；
- CTCP ACTION 投影为文本动作，`+reply` 投影为 reply segment；
- `account-tag` 或 extended-join account 优先作为稳定用户 ID，nickname 保留为显示名；
- JOIN/PART/QUIT/KICK、INVITE、TOPIC、MODE、NICK/ACCOUNT/AWAY/CHGHOST/SETNAME 投影为相应 canonical notice/request；
- 未专门解释的稳定消息保留完整 `raw_event` 和 `extensions.ircv3`。

IRC 没有标准媒体上传。公开 HTTP(S) 媒体 URL 会明确降级为文本；`can_send_image` 与 `can_send_record` 返回 false。TOPIC 是频道主题而非频道名称，因此只提供 `set_irc_topic` 平台动作，不伪装成 canonical `set_group_name`。

## 协商、恢复与请求关联

- 使用 CAP LS 302 处理多行 capability 列表，并在 ACK/NAK 后结束注册；
- SASL PLAIN/EXTERNAL 在 CAP END 前完成，`sasl_required` 禁止认证失败后静默匿名降级；
- managed connection 默认 TLS、支持 `AbortSignal`，断线后无限指数退避并用 generation 隔离旧连接；
- labeled-response 可用时并发关联请求与 BATCH；旧服务器上的 WHOIS/NAMES/CHATHISTORY 查询自动串行；
- message `msgid` 可在历史或重传中复用，因此 canonical 投递 ID 使用连接 generation + occurrence sequence，不错误吞掉合法重传；
- byte stream 只接受 CRLF，独立限制 IRCv3 tag section 与 512-byte main section。

## 平台能力

canonical 动作覆盖消息、历史、用户/频道/成员查询、nickname、离开频道、踢出/邀请/管理员、邀请处理、公告、状态和版本。平台动作额外覆盖 JOIN/PART、NOTICE/ACTION、TOPIC/MODE、KICK/INVITE、WHOIS/NAMES、MONITOR、AWAY、SETNAME、typing、CHATHISTORY、会话快照和受控原生命令。

能力不是固定宣传表：历史要求显式协商 WIP `draft/chathistory` 及其稳定依赖，并验证 CHATHISTORY ISUPPORT；MONITOR、setname、typing 同样按实际 ISUPPORT、CAP ACK 和 CLIENTTAGDENY 收敛。配置的 `event_commands` 也限定当前账号可产生的 canonical 事件。

默认 capability 集只包含稳定规范。`draft/multiline` 仍是 work-in-progress，不会伪装成稳定分段消息；用户可显式请求 vendor/draft capability，但未知语义只保留原始报文。

配置见 [IRCv3 配置](/config/adapter/ircv3)。官方参考：[IRCv3 Specifications](https://ircv3.net/irc/)、[Capability Negotiation](https://ircv3.net/specs/extensions/capability-negotiation.html)、[Message Tags](https://ircv3.net/specs/extensions/message-tags.html)、[SASL](https://ircv3.net/specs/extensions/sasl-3.2)、[Modern IRC](https://modern.ircdocs.horse/)。
