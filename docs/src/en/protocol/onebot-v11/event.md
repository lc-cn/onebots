# Events

OneBot V11 events are used to push various information received by the bot to the application.

## Event Format

All events have the following common fields:

| Field | Data Type | Description |
| ----- | ------- | --- |
| `time` | number | Event timestamp |
| `self_id` | number | Bot user ID that received the event |
| `post_type` | string | Event type |

## Message Events (message)

### Private Message

**Event Data**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `time` | number | Event timestamp |
| `self_id` | number | Bot user ID that received the event |
| `post_type` | string | `message` |
| `message_type` | string | `private` |
| `sub_type` | string | `friend`, `group`, `other` |
| `message_id` | number | Message ID |
| `user_id` | number | Sender user ID |
| `message` | message | Message content |
| `raw_message` | string | Raw message content |
| `font` | number | Font |
| `sender` | object | Sender information |

**sender Fields**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `user_id` | number | Sender user ID |
| `nickname` | string | Nickname |
| `sex` | string | Gender, `male` or `female` or `unknown` |
| `age` | number | Age |

**sub_type Description**

- `friend` - Friend message
- `group` - Group temporary session
- `other` - Other

### Group Message

**Event Data**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `time` | number | Event timestamp |
| `self_id` | number | Bot user ID that received the event |
| `post_type` | string | `message` |
| `message_type` | string | `group` |
| `sub_type` | string | `normal`, `anonymous`, `notice` |
| `message_id` | number | Message ID |
| `group_id` | number | Group ID |
| `user_id` | number | Sender user ID |
| `anonymous` | object \| null | Anonymous information, null if not anonymous message |
| `message` | message | Message content |
| `raw_message` | string | Raw message content |
| `font` | number | Font |
| `sender` | object | Sender information |

**sender Fields**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `user_id` | number | Sender user ID |
| `nickname` | string | Nickname |
| `card` | string | Group card/remark |
| `sex` | string | Gender, `male` or `female` or `unknown` |
| `age` | number | Age |
| `area` | string | Area |
| `level` | string | Member level |

## Related Links

- [OneBot V11 Protocol](/en/protocol/onebot-v11)
- [Actions](/en/protocol/onebot-v11/action)
- [CQ Code](/en/protocol/onebot-v11/cqcode)

