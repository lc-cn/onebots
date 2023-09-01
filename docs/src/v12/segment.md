# 消息段 (Segment)

## 标准消息段

### 文本消息段

```json
{
  "type": "text",
  "data": {
    "text": "Hello, world!"
  }
}
```

### 图片消息段

```json
{
  "type": "image",
  "data": {
    "url": "https://example.com/image.png"
  }
}
```

### 视频消息段

```json
{
  "type": "video",
  "data": {
    "url": "https://example.com/video.mp4"
  }
}
```

### 音频消息段

```json
{
  "type": "audio",
  "data": {
    "url": "https://example.com/audio.mp3"
  }
}
```

### 文件消息段

```json
{
  "type": "file",
  "data": {
    "url": "https://example.com/file.zip"
  }
}
```

### 表情消息段

```json
{
  "type": "face",
  "data": {
    "id": 1
  }
}
```

### 图片消息段

```json
{
  "type": "image",
  "data": {
    "url": "https://example.com/image.png"
  }
}
```

### 提及消息段

```json
{
  "type": "mention",
  "data": {
    "user_id": "123456789"
  }
}
```

### 引用消息段

```json
{
  "type": "quote",
  "data": {
    "id": "123456789"
  }
}
```
