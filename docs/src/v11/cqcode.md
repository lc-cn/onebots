# CQ码 (CQ CODE)

CQ 码是 OneBot V11 的消息段格式，用于在消息中表示特殊内容（如图片、表情等）。

## 格式

CQ 码的格式为：

```
[CQ:type,param1=value1,param2=value2]
```

- `type` - 消息段类型
- `param` - 参数名
- `value` - 参数值

## 转义

在 CQ 码中，以下字符需要转义：

| 字符 | 转义 |
| --- | --- |
| `&` | `&amp;` |
| `[` | `&#91;` |
| `]` | `&#93;` |
| `,` | `&#44;`（仅在 CQ 码参数值中） |

## 消息段类型

### text 纯文本

**格式**

```
纯文本内容（不需要 CQ 码）
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `text` | string | 纯文本内容 |

**示例**

```
Hello, World!
```

### face QQ 表情

**格式**

```
[CQ:face,id=表情ID]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `id` | string | QQ 表情 ID |

**示例**

```
[CQ:face,id=178]
```

### image 图片

**格式**

```
[CQ:image,file=文件名或URL]
```

**参数**

| 参数名 | 类型 | 默认值 | 说明 |
| ----- | --- | ----- | --- |
| `file` | string | - | 图片文件名、绝对路径或 URL |
| `type` | string | - | 图片类型，`flash` 表示闪照 |
| `url` | string | - | 图片 URL |
| `cache` | 0/1 | 1 | 只在通过网络 URL 发送时有效，是否使用已缓存的文件 |
| `proxy` | 0/1 | 1 | 只在通过网络 URL 发送时有效，是否通过代理下载文件 |
| `timeout` | number | - | 只在通过网络 URL 发送时有效，下载超时时间（秒） |

**示例**

```
[CQ:image,file=image.jpg]
[CQ:image,file=https://example.com/image.jpg]
[CQ:image,file=image.jpg,type=flash]
```

### record 语音

**格式**

```
[CQ:record,file=文件名或URL]
```

**参数**

| 参数名 | 类型 | 默认值 | 说明 |
| ----- | --- | ----- | --- |
| `file` | string | - | 语音文件名、绝对路径或 URL |
| `magic` | 0/1 | 0 | 是否为变声 |
| `url` | string | - | 语音 URL |
| `cache` | 0/1 | 1 | 只在通过网络 URL 发送时有效，是否使用已缓存的文件 |
| `proxy` | 0/1 | 1 | 只在通过网络 URL 发送时有效，是否通过代理下载文件 |
| `timeout` | number | - | 只在通过网络 URL 发送时有效，下载超时时间（秒） |

**示例**

```
[CQ:record,file=audio.amr]
[CQ:record,file=https://example.com/audio.amr,magic=1]
```

### video 短视频

**格式**

```
[CQ:video,file=文件名或URL]
```

**参数**

| 参数名 | 类型 | 默认值 | 说明 |
| ----- | --- | ----- | --- |
| `file` | string | - | 视频文件名、绝对路径或 URL |
| `url` | string | - | 视频 URL |
| `cache` | 0/1 | 1 | 只在通过网络 URL 发送时有效，是否使用已缓存的文件 |
| `proxy` | 0/1 | 1 | 只在通过网络 URL 发送时有效，是否通过代理下载文件 |
| `timeout` | number | - | 只在通过网络 URL 发送时有效，下载超时时间（秒） |

**示例**

```
[CQ:video,file=video.mp4]
[CQ:video,file=https://example.com/video.mp4]
```

### at @某人

**格式**

```
[CQ:at,qq=QQ号]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `qq` | string | QQ 号，`all` 表示 @全体成员 |

**示例**

```
[CQ:at,qq=12345678]
[CQ:at,qq=all]
```

### rps 猜拳魔法表情

**格式**

```
[CQ:rps]
```

**参数**

无

**示例**

```
[CQ:rps]
```

### dice 掷骰子魔法表情

**格式**

```
[CQ:dice]
```

**参数**

无

**示例**

```
[CQ:dice]
```

### shake 窗口抖动

**格式**

```
[CQ:shake]
```

**参数**

无

**示例**

```
[CQ:shake]
```

**注意**

仅支持好友消息使用。

### poke 戳一戳

**格式**

```
[CQ:poke,type=类型,id=ID]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `type` | string | 类型 |
| `id` | string | ID |

**示例**

```
[CQ:poke,type=1,id=1]
```

### anonymous 匿名发消息

**格式**

```
[CQ:anonymous]
```

**参数**

| 参数名 | 类型 | 默认值 | 说明 |
| ----- | --- | ----- | --- |
| `ignore` | 0/1 | 0 | 可选，表示无法匿名时是否继续发送 |

**示例**

```
[CQ:anonymous]
[CQ:anonymous,ignore=1]
```

**注意**

- 需要在群消息中使用
- 当 `ignore` 为 0 时，如果匿名失败则不发送消息
- 当 `ignore` 为 1 时，如果匿名失败则继续发送非匿名消息

### share 链接分享

**格式**

```
[CQ:share,url=链接,title=标题]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `url` | string | 链接 URL |
| `title` | string | 标题 |
| `content` | string | 可选，内容描述 |
| `image` | string | 可选，图片 URL |

**示例**

```
[CQ:share,url=https://example.com,title=Example]
[CQ:share,url=https://example.com,title=Example,content=Description,image=https://example.com/image.jpg]
```

### contact 推荐好友/推荐群

**格式**

```
[CQ:contact,type=类型,id=ID]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `type` | string | 推荐类型，`qq` 为推荐好友，`group` 为推荐群 |
| `id` | string | 被推荐的 QQ 号或群号 |

**示例**

```
[CQ:contact,type=qq,id=12345678]
[CQ:contact,type=group,id=87654321]
```

### location 位置

**格式**

```
[CQ:location,lat=纬度,lon=经度]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `lat` | number | 纬度 |
| `lon` | number | 经度 |
| `title` | string | 可选，标题 |
| `content` | string | 可选，内容描述 |

**示例**

```
[CQ:location,lat=39.9042,lon=116.4074]
[CQ:location,lat=39.9042,lon=116.4074,title=天安门,content=北京市东城区]
```

### music 音乐分享

**格式**

```
[CQ:music,type=类型,id=歌曲ID]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `type` | string | 音乐类型，`qq`、`163`、`xm`、`custom` |
| `id` | string | 歌曲 ID（仅在 type 不为 custom 时使用） |
| `url` | string | 点击后跳转目标 URL（仅在 type 为 custom 时使用） |
| `audio` | string | 音乐 URL（仅在 type 为 custom 时使用） |
| `title` | string | 标题（仅在 type 为 custom 时使用） |
| `content` | string | 可选，内容描述（仅在 type 为 custom 时使用） |
| `image` | string | 可选，图片 URL（仅在 type 为 custom 时使用） |

**示例**

```
[CQ:music,type=qq,id=001Qu4I30eVFYb]
[CQ:music,type=163,id=28391863]
[CQ:music,type=custom,url=https://example.com,audio=https://example.com/audio.mp3,title=Song Title]
```

### reply 回复

**格式**

```
[CQ:reply,id=消息ID]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `id` | string | 回复的消息 ID |

**示例**

```
[CQ:reply,id=123456]
```

**注意**

- 回复消息段必须在消息的开头
- 一条消息只能有一个回复

### forward 合并转发

**格式**

```
[CQ:forward,id=合并转发ID]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `id` | string | 合并转发 ID，需通过发送合并转发消息获取 |

**示例**

```
[CQ:forward,id=abc123]
```

### node 合并转发节点

**格式**

```
[CQ:node,id=消息ID]
```

**参数（引用消息）**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `id` | string | 转发的消息 ID |

**参数（自定义消息）**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `user_id` | number | 发送者 QQ 号 |
| `nickname` | string | 发送者昵称 |
| `content` | message | 消息内容 |

**示例**

```
[CQ:node,id=123456]
[CQ:node,user_id=12345678,nickname=Nickname,content=Message]
```

**注意**

- node 消息段只能在 `send_forward_msg` API 中使用

### xml XML 消息

**格式**

```
[CQ:xml,data=XML内容]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `data` | string | XML 内容 |

**示例**

```
[CQ:xml,data=<?xml version="1.0"?>...]
```

### json JSON 消息

**格式**

```
[CQ:json,data=JSON内容]
```

**参数**

| 参数名 | 类型 | 说明 |
| ----- | --- | --- |
| `data` | string | JSON 内容 |

**示例**

```
[CQ:json,data={"app":"com.tencent.bot",...}]
```

## 使用示例

### 发送带图片的消息

```
你好 [CQ:at,qq=12345678] [CQ:image,file=image.jpg]
```

### 发送带回复的消息

```
[CQ:reply,id=123456]收到！
```

### 发送多种类型的消息

```
[CQ:at,qq=all] 大家好！[CQ:face,id=178] 今天天气不错 [CQ:image,file=weather.jpg]
```

## 数组格式

除了 CQ 码字符串格式，OneBot V11 还支持数组格式：

```json
[
  { "type": "text", "data": { "text": "Hello " } },
  { "type": "at", "data": { "qq": "12345678" } },
  { "type": "image", "data": { "file": "image.jpg" } }
]
```

数组格式更易于程序处理，推荐在代码中使用。

## 工具函数

项目提供了 `CQCode` 工具类来处理 CQ 码：

```typescript
import { CQCode } from "@/protocols/onebot";

// 解析 CQ 码
const segments = CQCode.parse("Hello [CQ:at,qq=123]");

// 生成 CQ 码
const message = CQCode.stringify([
  CQCode.text("Hello "),
  CQCode.at(123),
]);

// 创建各种消息段
const atSegment = CQCode.at(12345678);
const imageSegment = CQCode.image("https://example.com/image.jpg");
const replySegment = CQCode.reply(999);
```
