# 事件 (Event)

OneBot V11 的事件用于向应用端推送机器人收到的各种信息。

## 事件格式

所有事件都有如下共同字段：

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | 事件类型 |

## 消息事件 (message)

### 私聊消息

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `message` |
| `message_type` | string | `private` |
| `sub_type` | string | `friend`、`group`、`other` |
| `message_id` | number | 消息 ID |
| `user_id` | number | 发送者 QQ 号 |
| `message` | message | 消息内容 |
| `raw_message` | string | 原始消息内容 |
| `font` | number | 字体 |
| `sender` | object | 发送人信息 |

**sender 字段**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `user_id` | number | 发送者 QQ 号 |
| `nickname` | string | 昵称 |
| `sex` | string | 性别，`male` 或 `female` 或 `unknown` |
| `age` | number | 年龄 |

**sub_type 说明**

- `friend` - 好友消息
- `group` - 群临时会话
- `other` - 其他

### 群消息

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `message` |
| `message_type` | string | `group` |
| `sub_type` | string | `normal`、`anonymous`、`notice` |
| `message_id` | number | 消息 ID |
| `group_id` | number | 群号 |
| `user_id` | number | 发送者 QQ 号 |
| `anonymous` | object \| null | 匿名信息，如果不是匿名消息则为 null |
| `message` | message | 消息内容 |
| `raw_message` | string | 原始消息内容 |
| `font` | number | 字体 |
| `sender` | object | 发送人信息 |

**sender 字段**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `user_id` | number | 发送者 QQ 号 |
| `nickname` | string | 昵称 |
| `card` | string | 群名片/备注 |
| `sex` | string | 性别，`male` 或 `female` 或 `unknown` |
| `age` | number | 年龄 |
| `area` | string | 地区 |
| `level` | string | 成员等级 |
| `role` | string | 角色，`owner` 或 `admin` 或 `member` |
| `title` | string | 专属头衔 |

**anonymous 字段**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `id` | number | 匿名用户 ID |
| `name` | string | 匿名用户名称 |
| `flag` | string | 匿名用户 flag，在调用禁言 API 时需要传入 |

**sub_type 说明**

- `normal` - 正常消息
- `anonymous` - 匿名消息
- `notice` - 系统提示（如「管理员已禁止群内匿名聊天」）

## 通知事件 (notice)

### 群文件上传

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `group_upload` |
| `group_id` | number | 群号 |
| `user_id` | number | 发送者 QQ 号 |
| `file` | object | 文件信息 |

**file 字段**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `id` | string | 文件 ID |
| `name` | string | 文件名 |
| `size` | number | 文件大小（字节数） |
| `busid` | number | busid（目前不清楚具体含义） |

### 群管理员变动

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `group_admin` |
| `sub_type` | string | `set`、`unset` |
| `group_id` | number | 群号 |
| `user_id` | number | 管理员 QQ 号 |

**sub_type 说明**

- `set` - 设置管理员
- `unset` - 取消管理员

### 群成员减少

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `group_decrease` |
| `sub_type` | string | `leave`、`kick`、`kick_me` |
| `group_id` | number | 群号 |
| `operator_id` | number | 操作者 QQ 号（如果是主动退群，则和 `user_id` 相同） |
| `user_id` | number | 离开者 QQ 号 |

**sub_type 说明**

- `leave` - 主动退群
- `kick` - 成员被踢
- `kick_me` - 登录号（机器人）被踢

### 群成员增加

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `group_increase` |
| `sub_type` | string | `approve`、`invite` |
| `group_id` | number | 群号 |
| `operator_id` | number | 操作者 QQ 号 |
| `user_id` | number | 加入者 QQ 号 |

**sub_type 说明**

- `approve` - 管理员已同意入群
- `invite` - 管理员邀请入群

### 群禁言

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `group_ban` |
| `sub_type` | string | `ban`、`lift_ban` |
| `group_id` | number | 群号 |
| `operator_id` | number | 操作者 QQ 号 |
| `user_id` | number | 被禁言 QQ 号 |
| `duration` | number | 禁言时长，单位秒 |

**sub_type 说明**

- `ban` - 禁言
- `lift_ban` - 解除禁言

### 好友添加

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `friend_add` |
| `user_id` | number | 新添加好友 QQ 号 |

### 群消息撤回

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `group_recall` |
| `group_id` | number | 群号 |
| `user_id` | number | 消息发送者 QQ 号 |
| `operator_id` | number | 操作者 QQ 号 |
| `message_id` | number | 被撤回的消息 ID |

### 好友消息撤回

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `friend_recall` |
| `user_id` | number | 好友 QQ 号 |
| `message_id` | number | 被撤回的消息 ID |

### 群内戳一戳

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `notify` |
| `sub_type` | string | `poke` |
| `group_id` | number | 群号 |
| `user_id` | number | 发送者 QQ 号 |
| `target_id` | number | 被戳者 QQ 号 |

### 群红包运气王

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `notify` |
| `sub_type` | string | `lucky_king` |
| `group_id` | number | 群号 |
| `user_id` | number | 红包发送者 QQ 号 |
| `target_id` | number | 运气王 QQ 号 |

### 群成员荣誉变更

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `notice` |
| `notice_type` | string | `notify` |
| `sub_type` | string | `honor` |
| `group_id` | number | 群号 |
| `user_id` | number | 成员 QQ 号 |
| `honor_type` | string | 荣誉类型，`talkative`、`performer`、`emotion` |

**honor_type 说明**

- `talkative` - 龙王
- `performer` - 群聊之火
- `emotion` - 快乐源泉

## 请求事件 (request)

### 加好友请求

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `request` |
| `request_type` | string | `friend` |
| `user_id` | number | 发送请求的 QQ 号 |
| `comment` | string | 验证信息 |
| `flag` | string | 请求 flag，在调用处理请求的 API 时需要传入 |

### 加群请求/邀请

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `request` |
| `request_type` | string | `group` |
| `sub_type` | string | `add`、`invite` |
| `group_id` | number | 群号 |
| `user_id` | number | 发送请求的 QQ 号 |
| `comment` | string | 验证信息 |
| `flag` | string | 请求 flag，在调用处理请求的 API 时需要传入 |

**sub_type 说明**

- `add` - 加群请求
- `invite` - 邀请登录号入群

## 元事件 (meta_event)

### 生命周期

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `meta_event` |
| `meta_event_type` | string | `lifecycle` |
| `sub_type` | string | `enable`、`disable`、`connect` |

**sub_type 说明**

- `enable` - OneBot 启用
- `disable` - OneBot 停用
- `connect` - WebSocket 连接成功

### 心跳

**事件数据**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `time` | number | 事件发生的时间戳 |
| `self_id` | number | 收到事件的机器人 QQ 号 |
| `post_type` | string | `meta_event` |
| `meta_event_type` | string | `heartbeat` |
| `status` | object | 状态信息 |
| `interval` | number | 到下次心跳的间隔，单位毫秒 |

**status 字段**

| 字段名 | 数据类型 | 说明 |
| ----- | ------- | --- |
| `online` | boolean | 当前 QQ 在线 |
| `good` | boolean | 状态符合预期 |
