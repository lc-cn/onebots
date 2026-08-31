# CQ Code

CQ Code is the message segment format for OneBot V11, used to represent special content (such as images, emojis, etc.) in messages.

## Format

CQ Code format:

```
[CQ:type,param1=value1,param2=value2]
```

- `type` - Message segment type
- `param` - Parameter name
- `value` - Parameter value

## Escaping

In CQ Code, the following characters need to be escaped:

| Character | Escape |
| --- | --- |
| `&` | `&amp;` |
| `[` | `&#91;` |
| `]` | `&#93;` |
| `,` | `&#44;` (only in CQ Code parameter values) |

## Message Segment Types

### text Plain Text

**Format**

```
Plain text content (no CQ Code needed)
```

**Parameters**

| Parameter | Type | Description |
| ----- | --- | --- |
| `text` | string | Plain text content |

**Example**

```
Hello, World!
```

### face QQ Emoji

**Format**

```
[CQ:face,id=emoji_id]
```

**Parameters**

| Parameter | Type | Description |
| ----- | --- | --- |
| `id` | string | QQ emoji ID |

**Example**

```
[CQ:face,id=178]
```

### image Image

**Format**

```
[CQ:image,file=filename_or_url]
```

**Parameters**

| Parameter | Type | Default | Description |
| ----- | --- | ----- | --- |
| `file` | string | - | Image filename, absolute path, or URL |
| `type` | string | - | Image type, `flash` for flash image |
| `url` | string | - | Image URL |
| `cache` | 0/1 | 1 | Only valid when sending via network URL, whether to use cached file |
| `proxy` | 0/1 | 1 | Only valid when sending via network URL, whether to download via proxy |
| `timeout` | number | - | Only valid when sending via network URL, download timeout (seconds) |

**Example**

```
[CQ:image,file=image.jpg]
[CQ:image,file=https://example.com/image.jpg]
[CQ:image,file=image.jpg,type=flash]
```

## Related Links

- [OneBot V11 Protocol](/en/protocol/onebot-v11)
- [Actions](/en/protocol/onebot-v11/action)
- [Events](/en/protocol/onebot-v11/event)

