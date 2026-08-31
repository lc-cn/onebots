# Events

## Group Events

### Group Member Increase

#### Event Name `notice.group.increase`
#### Event Parameters

| Parameter | Type | Description |
| --- |--------| --- |
| group_id | string | Group ID |
| user_id | string | User ID who joined |

### Group Member Decrease

#### Event Name `notice.group.decrease`
#### Event Parameters

| Parameter | Type | Description |
| --- |--------| --- |
| group_id | string | Group ID |
| user_id | string | User ID who left |

### Group Member Banned

#### Event Name `notice.group.ban`
#### Event Parameters

| Parameter | Type | Description |
| --- |--------| --- |
| group_id | string | Group ID |
| user_id | string | User ID who was banned |
| duration | int | Ban duration in seconds |

## Message Events

### Private Message

#### Event Name `message.private`
#### Event Parameters

| Parameter | Type | Description |
| --- |--------| --- |
| message_id | string | Message ID |
| user_id | string | Sender user ID |
| message | message | Message content |

### Group Message

#### Event Name `message.group`
#### Event Parameters

| Parameter | Type | Description |
| --- |--------| --- |
| message_id | string | Message ID |
| group_id | string | Group ID |
| user_id | string | Sender user ID |
| message | message | Message content |

## Related Links

- [OneBot V12 Protocol](/en/protocol/onebot-v12)
- [Actions](/en/protocol/onebot-v12/action)
- [Message Segments](/en/protocol/onebot-v12/segment)

