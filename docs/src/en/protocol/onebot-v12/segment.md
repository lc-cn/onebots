# Message Segments

## Standard Message Segments

### Text Message Segment

```json
{
  "type": "text",
  "data": {
    "text": "Hello, world!"
  }
}
```

### Image Message Segment

```json
{
  "type": "image",
  "data": {
    "url": "https://example.com/image.png"
  }
}
```

### Video Message Segment

```json
{
  "type": "video",
  "data": {
    "url": "https://example.com/video.mp4"
  }
}
```

### Audio Message Segment

```json
{
  "type": "audio",
  "data": {
    "url": "https://example.com/audio.mp3"
  }
}
```

### File Message Segment

```json
{
  "type": "file",
  "data": {
    "url": "https://example.com/file.zip"
  }
}
```

### Face Message Segment

```json
{
  "type": "face",
  "data": {
    "id": 1
  }
}
```

### Mention Message Segment

```json
{
  "type": "mention",
  "data": {
    "user_id": "123456789"
  }
}
```

## Related Links

- [OneBot V12 Protocol](/en/protocol/onebot-v12)
- [Actions](/en/protocol/onebot-v12/action)
- [Events](/en/protocol/onebot-v12/event)

