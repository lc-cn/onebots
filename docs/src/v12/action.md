# 标准动作

## `get_self_info` 获取机器人自身信息

### 请求参数

无。

### 响应数据

| 字段名                | 数据类型   | 默认值 | 说明                    |
|--------------------|--------|-----|-----------------------|
| `user_id`          | string | -   | 机器人用户 ID              |
| `user_name`        | string | -   | 机器人名称/姓名/昵称           |
| `platform`         | string | -   | 'qq'                  |
| `user_displayname` | string | -   | 机器人账号设置的显示名称，若无则为空字符串 |

### 请求示例

```json
{
  "action": "get_self_info",
  "params": {}
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": {
        "user_id": "123456",
        "user_name": "我是大笨蛋",
        "platform": "qq",
        "user_displayname": ""
    },
    "message": ""
}
```

## `get_user_info` 获取用户信息

### 请求参数

| 字段名       | 数据类型   | 默认值 | 说明                  |
|-----------|--------|-----|---------------------|
| `user_id` | string | -   | 用户 ID，可以是好友，也可以是陌生人 |

### 响应数据

| 字段名                | 数据类型   | 默认值 | 说明                      |
|--------------------|--------|-----|-------------------------|
| `user_id`          | string | -   | 用户 ID                   |
| `user_name`        | string | -   | 用户名称/姓名/昵称              |
| `user_displayname` | string | -   | 用户设置的显示名称，若无则为空字符串      |
| `user_remark`      | string | -   | 机器人账号对该用户的备注名称，若无则为空字符串 |

### 请求示例

```json
{
  "action": "get_user_info",
  "params": {
    "user_id": "123456"
  }
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": {
        "user_id": "123456",
        "nickname": "我是大笨蛋",
        "sex": "",
        "age": 18,
        "area": ""
    },
    "message": ""
}
```

## `get_friend_list` 获取好友列表

获取机器人的关注者或好友列表。

### 请求参数

无请求参数。

### 响应数据

好友信息列表，数据类型为 ``list[resp[`get_user_info`]]``。

### 请求示例

```json
{
  "action": "get_friend_list",
  "params": {}
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": [
        {
            "user_id": "123456",
            "nickname": "我是大笨蛋",
            "remark": "一个自称大笨蛋的人",
            "sex": "",
            "age": 18,
            "area": "",
            "class_id": ""
        },
        {
            "user_id": "654321",
            "nickname": "我是大笨蛋",
            "remark": "一个自称大笨蛋的人",
            "sex": "",
            "age": 18,
            "area": "",
            "class_id": ""
        }
    ],
    "message": ""
}
```

## `get_group_info` 获取群信息

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明   |
|------------|--------|-----|------|
| `group_id` | string | -   | 群 ID |

### 响应数据

| 字段名          | 数据类型   | 默认值 | 说明   |
|--------------|--------|-----|------|
| `group_id`   | string | -   | 群 ID |
| `group_name` | string | -   | 群名称  |
|`member_count` | number | -   | 群成员数量  |
|`max_member_count` | number | -   | 群最大成员数量  |
|`owner_id` | number | -   | 群主QQ  |
|`admin_flag` | boolean | -   | 是否为管理员  |
|`last_join_time` | number | -   | 最后加群时间  |
|`last_sent_time` | number | -   | 最后发言时间  |
|`shutup_time_whole` | number | -   | 全员禁言时间  |
|`shutup_time_me` | number | -   | 我的禁言时间  |
|`create_time` | number | -   | 群创建时间  |
|`grade` | number | -   | 群等级  |
|`max_admin_count` | number | -   | 最大管理员数量  |
|`active_member_count` | number | -   | 活跃成员数量  |
|`update_time` | number | -   | 最后更新时间  |

### 请求示例

```json
{
  "action": "get_group_info",
  "params": {
    "group_id": "123456"
  }
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": {
        "group_id": "123456",
        "group_name": "一群大笨蛋",
        "member_count": 100,
        "max_member_count": 200,
        "owner_id": 123456,
        "admin_flag": true,
        "last_join_time": 123456,
        "last_sent_time": 123456,
        "shutup_time_whole": 123456,
        "shutup_time_me": 123456,
        "create_time": 123456,
        "grade": 123456,
        "max_admin_count": 123456,
        "active_member_count": 123456,
        "update_time": 123456
    },
    "message": ""
}
```

## `get_group_list` 获取群列表

获取机器人加入的群列表。

### 请求参数

无。

### 响应数据

群信息列表，数据类型为 ``list[resp[`get_group_info`]]``。

### 请求示例

```json
{
  "action": "get_group_list",
  "params": {}
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": [
        {
            "group_id": "123456",
            "group_name": "一群大笨蛋",
            "member_count": 100,
            "max_member_count": 200,
            "owner_id": 123456,
            "admin_flag": true,
            "last_join_time": 123456,
            "last_sent_time": 123456,
            "shutup_time_whole": 123456,
            "shutup_time_me": 123456,
            "create_time": 123456,
            "grade": 123456,
            "max_admin_count": 123456,
            "active_member_count": 123456,
            "update_time": 123456
        },
        {
            "group_id": "654321",
            "group_name": "一群大笨蛋2群",
            "member_count": 100,
            "max_member_count": 200,
            "owner_id": 123456,
            "admin_flag": true,
            "last_join_time": 123456,
            "last_sent_time": 123456,
            "shutup_time_whole": 123456,
            "shutup_time_me": 123456,
            "create_time": 123456,
            "grade": 123456,
            "max_admin_count": 123456,
            "active_member_count": 123456,
            "update_time": 123456
        }
    ],
    "message": ""
}
```

## `get_group_member_info` 获取群成员信息

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群 ID  |
| `user_id`  | string | -   | 用户 ID |

### 响应数据

| 字段名                 | 数据类型   | 默认值 | 说明                              |
|---------------------|--------|-----|---------------------------------|
| `group_id`          | string | -   | 群 ID                            |
| `user_id`           | string | -   | 用户 ID                           |
| `nickname`          | string | -   | 用户名称/姓名/昵称                      |
| `sex`               | string | -   | 性别，`male` 或 `female`            |
| `card`              | string | -   | 群名片                             |
| `age`               | number | -   | 年龄                              |
| `area`              | string | -   | 地区                              |
| `join_time`         | number | -   | 入群时间                            |
| `last_sent_time`    | number | -   | 最后发言时间                          |
| `level`             | number | -   | 等级                              |
| `rank`              | string | -   | 头衔                              |
| `role`              | string | -   | 角色，`owner` 或 `admin` 或 `member` |
| `title`             | string | -   | 专属头衔                            |
| `title_expire_time` | number | -   | 专属头衔过期时间                        |
| `shutup_time`       | number | -   | 禁言时间                            |
| `update_time`       | number | -   | 最后更新时间                          |


### 请求示例

```json
{
  "action": "get_group_member_info",
  "params": {
    "group_id": "123456",
    "user_id": "3847573"
  }
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": {
        "group_id": "123456",
        "user_id": "3847573",
        "nickname": "我是大笨蛋",
        "sex": "male",
        "card": "本群最菜的",
        "age": 18,
        "area": "中国",
        "join_time": 123456,
        "last_sent_time": 123456,
        "level": 123456,
        "rank": "群员",
        "role": "member",
        "title": "本群最菜的",
        "title_expire_time": 123456,
        "shutup_time": 123456,
        "update_time": 123456
    },
    "message": ""
}
```

## `get_group_member_list` 获取群成员列表

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明   |
|------------|--------|-----|------|
| `group_id` | string | -   | 群 ID |

### 响应数据

群成员信息列表，数据类型为 ``list[resp[`get_group_member_info`]]``。

### 请求示例

```json
{
  "action": "get_group_member_list",
  "params": {
    "group_id": "123456"
  }
}
```

### 响应示例

```json
{
    "status": "ok",
    "retcode": 0,
    "data": [
        {
            "user_id": "111222333",
            "nickname": "我是大笨蛋",
            "sex": "male",
            "card": "本群最菜的",
            "age": 18,
            "area": "中国",
            "join_time": 123456,
            "last_sent_time": 123456,
            "level": 123456,
            "rank": "群员",
            "role": "member",
            "title": "本群最菜的",
            "title_expire_time": 123456,
            "shutup_time": 123456,
            "update_time": 123456
        },
        {
            "user_id": "444555666",
            "nickname": "我是小笨蛋",
            "sex": "male",
            "card": "本群最菜的",
            "age": 18,
            "area": "中国",
            "join_time": 123456,
            "last_sent_time": 123456,
            "level": 123456,
            "rank": "群员",
            "role": "member",
            "title": "本群最强的",
            "title_expire_time": 123456,
            "shutup_time": 123456,
            "update_time": 123456
        }
    ],
    "message": ""
}
```

## `set_group_name` 设置群名称

### 请求参数

| 字段名          | 数据类型   | 默认值 | 说明   |
|--------------|--------|-----|------|
| `group_id`   | string | -   | 群 ID |
| `group_name` | string | -   | 新群名称 |

### 响应数据

无。

### 请求示例

```json
{
  "action": "set_group_name",
  "params": {
    "group_id": "2452352435",
    "group_name": "一个非常普通的群名"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": null,
  "message": ""
}
```

## `leave_group` 退出群

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明   |
|------------|--------|-----|------|
| `group_id` | string | -   | 群 ID |

### 响应数据

无。

### 请求示例

```json
{
  "action": "leave_group",
  "params": {
    "group_id": "2452352435"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": null,
  "message": ""
}
```

## `get_guild_info` 获取群组信息(暂未支持)

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `guild_id` | string | -   | 群组 ID |

### 响应数据

| 字段名          | 数据类型   | 默认值 | 说明    |
|--------------|--------|-----|-------|
| `guild_id`   | string | -   | 群组 ID |
| `guild_name` | string | -   | 群组名称  |

### 请求示例

```json
{
  "action": "get_guild_info",
  "params": {
    "guild_id": "123456"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": {
    "guild_id": "12345",
    "guild_name": "一群大笨蛋"
  },
  "message": ""
}
   ```

## `get_guild_list` 获取群组列表

获取机器人加入的群组列表。

### 请求参数

无。

### 响应数据

群组信息列表，数据类型为 ``list[resp[`get_guild_info`]]``。

### 请求示例

```json
{
  "action": "get_guild_list",
  "params": {}
}
   ```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": [
    {
      "guild_id": "12345",
      "guild_name": "一群大笨蛋"
    },
    {
      "guild_id": "54321",
      "guild_name": "一群大笨蛋2群"
    }
  ],
  "message": ""
}
   ```

## `get_guild_member_list` 获取群组成员列表

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `guild_id` | string | -   | 群组 ID |

### 响应数据

群组成员信息列表，数据类型为 ``list[resp[`get_guild_member_info`]]``。

### 请求示例

```json
{
  "action": "get_guild_member_list",
  "params": {
    "guild_id": "123456"
  }
}
   ```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": [
    {
        "tiny_id": "string",
        "card": "string",
        "nickname": "string",
        "role": "GuildRole",
        "join_time": "number"
    },
  ],
  "message": ""
}
   ```


## `get_channel_info` 获取频道信息(暂未支持)

### 请求参数

| 字段名          | 数据类型   | 默认值 | 说明    |
|--------------|--------|-----|-------|
| `guild_id`   | string | -   | 群组 ID |
| `channel_id` | string | -   | 频道 ID |

### 响应数据

| 字段名            | 数据类型   | 默认值 | 说明    |
|----------------|--------|-----|-------|
| `channel_id`   | string | -   | 频道 ID |
| `channel_name` | string | -   | 频道名称  |

### 请求示例

```json
{
  "action": "get_channel_info",
  "params": {
    "guild_id": "123456",
    "channel_id": "12"
  }
}
   ```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": {
    "channel_id": "12",
    "channel_name": "笨蛋频道"
  },
  "message": ""
}
   ```

## `get_channel_list` 获取频道列表

获取指定群组中机器人可见的频道列表。

### 请求参数

| 字段名           | 数据类型   | 默认值     | 说明               |
|---------------|--------|---------|------------------|
| `guild_id`    | string | -       | 群组 ID            |
| `joined_only` | bool   | `false` | 只获取机器人账号已加入的频道列表 |

### 响应数据

频道信息列表，数据类型为 ``list[resp[`get_channel_info`]]``。

### 请求示例

```json
{
  "action": "get_channel_list",
  "params": {
    "guild_id": "12345"
  }
}
   ```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": [
    {
      "channel_id": "12",
      "channel_name": "笨蛋频道"
    },
    {
      "channel_id": "13",
      "channel_name": "聪明频道"
    }
  ],
  "message": ""
}
   ```

# 扩展动作

## `send_user_like` 发送用户赞
为指定用户点赞

### 请求参数

| 字段名       | 数据类型   | 默认值 | 说明    |
|-----------|--------|-----|-------|
| `user_id` | string | -   | 用户 ID |
| `times`   | number | 10` | 点赞次数  |

### 响应数据
无

### 请求示例

```json
{
  "action": "send_user_like",
  "params": {
    "user_id": "123456",
    "times": 10
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `set_group_kick` 群组踢人

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `user_id`  | string | -   | 用户 ID |
| `reject_add_request`  | bool | false   | 拒绝再加群请求 |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_kick",
  "params": {
    "group_id": "123456",
    "user_id": "123456",
    "reject_add_request": false
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `set_essence_message` 设置群精华消息

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `message_id`  | string | -   | 消息 ID |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_essence_message",
  "params": {
    "group_id": "123456",
    "message_id": "123456"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `delete_essence_message` 移除群精华

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `message_id`  | string | -   | 消息 ID |

### 响应数据
无

### 请求示例

```json
{
  "action": "delete_essence_message",
  "params": {
    "group_id": "123456",
    "message_id": "123456"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `set_group_ban` 群组禁言

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `user_id`  | string | -   | 用户 ID |
| `duration`  | number | -   | 禁言时长，单位秒 |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_ban",
  "params": {
    "group_id": "123456",
    "user_id": "123456",
    "duration": 60
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `set_group_whole_ban` 群组全员禁言

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `enable`  | bool | -   | 是否开启全员禁言 |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_whole_ban",
  "params": {
    "group_id": "123456",
    "enable": true
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `set_group_admin` 设置群管理员

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `user_id`  | string | -   | 用户 ID |
| `enable`  | bool | -   | 是否设置为管理员 |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_admin",
  "params": {
    "group_id": "123456",
    "user_id": "123456",
    "enable": true
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "data": true,
  "message": ""
}
```

## `set_group_anonymous_ban` 群组匿名用户禁言

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `anonymous`  | object | -   | 匿名用户信息 |
| `anonymous_flag`  | string | -   | 匿名用户标识 |
| `duration`  | number | -   | 禁言时长，单位秒 |

### 响应数据
无

## `set_group_card` 设置群名片

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `user_id`  | string | -   | 用户 ID |
| `card`  | string | -   | 群名片 |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_card",
  "params": {
    "group_id": "123456",
    "user_id": "123456",
    "card": "大笨蛋"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "message": ""
}
```

## `set_group_leave` 退出群组

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_leave",
  "params": {
    "group_id": "123456"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "message": ""
}
```

## `set_group_special_title` 设置群组专属头衔

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |
| `user_id`  | string | -   | 用户 ID |
| `special_title`  | string | -   | 专属头衔 |
| `duration`  | number | -   | 专属头衔有效期，单位秒 |

### 响应数据
无

### 请求示例

```json
{
  "action": "set_group_special_title",
  "params": {
    "group_id": "123456",
    "user_id": "123456",
    "special_title": "大笨蛋",
    "duration": 60
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "message": ""
}
```

## `send_group_sign` 群签到

### 请求参数

| 字段名        | 数据类型   | 默认值 | 说明    |
|------------|--------|-----|-------|
| `group_id` | string | -   | 群组 ID |

### 响应数据
无

### 请求示例

```json
{
  "action": "send_group_sign",
  "params": {
    "group_id": "123456"
  }
}
```

### 响应示例

```json
{
  "status": "ok",
  "retcode": 0,
  "message": ""
}
```
