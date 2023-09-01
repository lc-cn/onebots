# 事件

## 群事件

### 群成员增加

#### 事件名 `notice.group.increase`
#### 事件参数

| 参数名 | 类型     | 说明 |
| --- |--------| --- |
| group_id | string | 群号 |
| user_id | string    | 加入的 QQ 号 |

### 群成员减少

#### 事件名 `notice.group.decrease`
#### 事件参数

| 参数名 | 类型     | 说明 |
| --- |--------| --- |
| group_id | string | 群号 |
| user_id | string    | 离开的 QQ 号 |

### 群成员被禁言  

#### 事件名 `notice.group.ban`
#### 事件参数

| 参数名 | 类型     | 说明 |
| --- |--------| --- |
| group_id | string | 群号 |
| user_id | string    | 被禁言的 QQ 号 |
| duration | int    | 禁言时长，单位秒 |
