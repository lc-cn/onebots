# ICQQ

| 字段名      | 类型                                               | 描述                      | 默认值 |
|----------|--------------------------------------------------|-------------------------|-----|
| versions | [OneBotWithVersion\<'V11'\|'V12'\>](./common.md) | 该机器人的OneBot配置，将覆盖全局通用配置 | -   |
| password | string                                           | 机器人密码                   | -   |
| protocol | [Protocol](#Protocol)                            | QQ机器人协议配置               | 必填  |

## Protocol

| 字段名                | 类型                    | 描述                                                                  | 默认值                              |
|--------------------|-----------------------|---------------------------------------------------------------------|----------------------------------|
| platform           | [Platform](#Platform) | 登录平台                                                                | 2                                |
| ver                | string                | 登录Apk版本                                                             | -                                |
| sign_api_addr      | string                | 签名服务器地址，未配置可能会导致登录失败和无法收发消息                                         | -                                |
| data_dir           | string                | 数据存储目录                                                              | path.join(process.cwd(), "data") |
| log_config         | string                | [Configuration](https://log4js-node.github.io/log4js-node/api.html) | -                                |
| ignore_self        | boolean               | 群聊和频道中过滤自己的消息                                                       | true                             |
| resend             | boolean               | 被风控时是否尝试用分片发送                                                       | true                             |
| reconn_interval    | number                | 触发`system.offline.network`事件后的重新登录间隔秒数                              | 5                                |
| cache_group_member | boolean               | 是否缓存群员列表                                                            | true                             |
| auto_server        | boolean               | 自动选择最优服务器                                                           | true                             |
| ffmpeg_path        | string                | ffmpeg配置，需自行安装ffmpeg                                                | -                                |
| ffprobe_path       | string                | ffmpeg配置，需自行安装ffmpeg                                                | -                                |

## Platform

| 可选值 | 描述    |
|-----|-------|
| 1   | 安卓手机  |
| 2   | 安卓平板  |
| 3   | 安卓手表  |
| 4   | MacOS |
| 5   | iPad  |
| 6   | Tim   |

