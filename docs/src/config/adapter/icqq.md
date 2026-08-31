# ICQQ 适配器配置

ICQQ 适配器配置说明。

## 配置项

### password

- **类型**: `string`
- **必填**: ❌
- **说明**: QQ 密码，不填则使用扫码登录

### protocol

协议配置对象。

#### protocol.platform

- **类型**: `number`
- **默认值**: `2`
- **说明**: 登录平台

| 值 | 平台 |
|----|------|
| 1 | 安卓手机 |
| 2 | 安卓平板（推荐） |
| 3 | 安卓手表 |
| 4 | MacOS |
| 5 | iPad |
| 6 | Tim |

#### protocol.ver

- **类型**: `string`
- **必填**: ❌
- **说明**: 登录 Apk 版本

#### protocol.sign_api_addr

- **类型**: `string`
- **必填**: ❌（强烈推荐配置）
- **说明**: 签名服务器地址，未配置可能会导致登录失败和无法收发消息

#### protocol.data_dir

- **类型**: `string`
- **默认值**: `path.join(process.cwd(), "data")`
- **说明**: 数据存储目录

#### protocol.log_config

- **类型**: `object`
- **必填**: ❌
- **说明**: [log4js Configuration](https://log4js-node.github.io/log4js-node/api.html)

#### protocol.ignore_self

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 群聊和频道中过滤自己的消息

#### protocol.resend

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 被风控时是否尝试用分片发送

#### protocol.reconn_interval

- **类型**: `number`
- **默认值**: `5`
- **单位**: 秒
- **说明**: 触发 `system.offline.network` 事件后的重新登录间隔秒数

#### protocol.cache_group_member

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 是否缓存群员列表

#### protocol.auto_server

- **类型**: `boolean`
- **默认值**: `true`
- **说明**: 自动选择最优服务器

#### protocol.ffmpeg_path

- **类型**: `string`
- **必填**: ❌
- **说明**: ffmpeg 路径，需自行安装 ffmpeg

#### protocol.ffprobe_path

- **类型**: `string`
- **必填**: ❌
- **说明**: ffprobe 路径，需自行安装 ffmpeg

## 配置示例

### 扫码登录

```yaml
icqq.123456789:
  protocol:
    platform: 2
    sign_api_addr: 'http://127.0.0.1:8080'
```

### 密码登录

```yaml
icqq.123456789:
  password: 'your_password'
  protocol:
    platform: 2
    sign_api_addr: 'http://127.0.0.1:8080'
    data_dir: './data/icqq'
    ignore_self: true
    resend: true
    reconn_interval: 5
    cache_group_member: true
    auto_server: true
```

## 签名服务器

::: warning 重要
ICQQ 协议需要签名服务器才能正常登录和收发消息。
:::

签名服务器部署请参考：
- [unidbg-fetch-qsign](https://github.com/fuqiuluo/unidbg-fetch-qsign)

## 相关链接

- [适配器配置指南](/guide/adapter)
- [ICQQ 平台文档](/platform/icqq)
