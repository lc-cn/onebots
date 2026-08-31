# Standard Actions

## `get_self_info` Get Bot Self Information

### Request Parameters

None.

### Response Data

| Field | Data Type | Default | Description |
|--------------------|--------|-----|-----------------------|
| `user_id` | string | - | Bot user ID |
| `user_name` | string | - | Bot name/nickname |
| `platform` | string | - | Platform name |
| `user_displayname` | string | - | Bot account display name, empty string if not set |

### Request Example

```json
{
  "action": "get_self_info",
  "params": {}
}
```

### Response Example

```json
{
    "status": "ok",
    "retcode": 0,
    "data": {
        "user_id": "123456",
        "user_name": "My Bot",
        "platform": "qq",
        "user_displayname": ""
    },
    "message": ""
}
```

## `get_user_info` Get User Information

### Request Parameters

| Field | Data Type | Default | Description |
|-----------|--------|-----|---------------------|
| `user_id` | string | - | User ID, can be friend or stranger |

### Response Data

| Field | Data Type | Default | Description |
|--------------------|--------|-----|-------------------------|
| `user_id` | string | - | User ID |
| `user_name` | string | - | User name/nickname |
| `user_displayname` | string | - | User display name, empty string if not set |
| `user_remark` | string | - | Bot account remark name for this user, empty string if not set |

### Request Example

```json
{
  "action": "get_user_info",
  "params": {
    "user_id": "123456"
  }
}
```

## `send_message` Send Message

### Request Parameters

| Field | Data Type | Default | Description |
|-----------|--------|-----|---------------------|
| `detail_type` | string | - | Message detail type: `private`, `group`, `channel` |
| `user_id` | string | - | Target user ID (required for `private`) |
| `group_id` | string | - | Target group ID (required for `group`) |
| `guild_id` | string | - | Target guild ID (required for `channel`) |
| `channel_id` | string | - | Target channel ID (required for `channel`) |
| `message` | message | - | Message content |

### Response Data

| Field | Data Type | Description |
| ----- | ------- | --- |
| `message_id` | string | Message ID |

## Related Links

- [OneBot V12 Protocol](/en/protocol/onebot-v12)
- [Events](/en/protocol/onebot-v12/event)
- [Message Segments](/en/protocol/onebot-v12/segment)

