# Actions

OneBot V11 actions are API interfaces for calling various bot functions.

## Message Related

### send_private_msg Send Private Message

**Parameters**

| Field | Data Type | Default | Description |
| ----- | ------- | ----- | --- |
| `user_id` | number | - | Target user ID |
| `message` | message | - | Message content to send |
| `auto_escape` | boolean | false | Whether to send message content as plain text |

**Response Data**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `message_id` | number | Message ID |

### send_group_msg Send Group Message

**Parameters**

| Field | Data Type | Default | Description |
| ----- | ------- | ----- | --- |
| `group_id` | number | - | Group ID |
| `message` | message | - | Message content to send |
| `auto_escape` | boolean | false | Whether to send message content as plain text |

**Response Data**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `message_id` | number | Message ID |

### send_msg Send Message

**Parameters**

| Field | Data Type | Default | Description |
| ----- | ------- | ----- | --- |
| `message_type` | string | - | Message type, supports `private`, `group` |
| `user_id` | number | - | Target user ID (required when message type is `private`) |
| `group_id` | number | - | Group ID (required when message type is `group`) |
| `message` | message | - | Message content to send |
| `auto_escape` | boolean | false | Whether to send message content as plain text |

**Response Data**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `message_id` | number | Message ID |

### delete_msg Delete Message

**Parameters**

| Field | Data Type | Default | Description |
| ----- | ------- | ----- | --- |
| `message_id` | number | - | Message ID |

**Response Data**

None

### get_msg Get Message

**Parameters**

| Field | Data Type | Default | Description |
| ----- | ------- | ----- | --- |
| `message_id` | number | - | Message ID |

**Response Data**

| Field | Data Type | Description |
| ----- | ------- | --- |
| `message_id` | number | Message ID |
| `real_id` | number | Real message ID |
| `sender` | object | Sender information |
| `time` | number | Message time |
| `message` | message | Message content |

## Related Links

- [OneBot V11 Protocol](/en/protocol/onebot-v11)
- [Events](/en/protocol/onebot-v11/event)
- [CQ Code](/en/protocol/onebot-v11/cqcode)

