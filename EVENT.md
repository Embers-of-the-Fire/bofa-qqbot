# Event API

HTTP endpoint for pushing events to the bot.

## Endpoint

```
POST https://bot.efa-tech.dev/event
```

## Authentication

Bearer authentication with the pre-shared `EVENT_SECRET`:

```
Authorization: Bearer <EVENT_SECRET>
```

## Request

```json
{
  "type": "<event type>",
  "payload": { }
}
```

| Field   | Type   | Description                        |
| ------- | ------ | ---------------------------------- |
| type    | string | Event type, see below              |
| payload | object | Event content, schema depends on type |

## Response

```json
{
  "status": "ok | error",
  "errorcode": 0,
  "error": { "message": "..." }
}
```

| Field     | Type   | Description                                  |
| --------- | ------ | -------------------------------------------- |
| status    | string | `ok` or `error`                              |
| errorcode | int    | Error enum, `0` on success                   |
| error     | object | Only present on error, contains `message`    |

### Error codes

| Code | Name              | HTTP | Description                              |
| ---- | ----------------- | ---- | ---------------------------------------- |
| 0    | None              | 200  | Success                                  |
| 1    | Unauthorized      | 401  | Missing or wrong bearer token            |
| 2    | MalformedBody     | 400  | Request body is not valid JSON           |
| 3    | UnknownEventType  | 400  | `type` is not a supported event          |
| 4    | InvalidPayload    | 400  | `payload` does not match the event schema |

## Events

### `release-created`

A new release was published. The bot posts a Markdown message to every
group listed in the `recognized-group` KV configuration:

```markdown
# EFA {version}
> 标签：{tag}

{changelog}
```

Payload:

| Field     | Type   | Description              |
| --------- | ------ | ------------------------ |
| version   | string | Release version          |
| tag       | string | Git tag                  |
| changelog | string | Changelog in Markdown    |

Example:

```sh
curl -X POST https://bot.efa-tech.dev/event \
  -H "Authorization: Bearer $EVENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "release-created",
    "payload": {
      "version": "1.2.3",
      "tag": "v1.2.3",
      "changelog": "# Changes\n\n- New feature"
    }
  }'
```

### `data_update`

Game data was updated on one or more servers. The bot posts a Markdown
message to every group listed in the `recognized-group` KV configuration:

```markdown
# 数据更新

本次更新涉及以下版本：
- {name} ({id})
  版本：{version}
  数据同步：{build}
  创建时间：{createdAt}
```

One list item is rendered per server.

Payload:

| Field    | Type   | Description                            |
| -------- | ------ | -------------------------------------- |
| servers  | array  | Non-empty list of server update entries |

Each entry in `servers`:

| Field     | Type   | Description                              |
| --------- | ------ | ---------------------------------------- |
| id        | string | Server identifier                        |
| name      | string | Localized Chinese server name            |
| build     | int    | Build number of the synced data          |
| version   | string | Game version                             |
| createdAt | string | ISO 8601 timestamp of the data snapshot  |

Example:

```sh
curl -X POST https://bot.efa-tech.dev/event \
  -H "Authorization: Bearer $EVENT_SECRET" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "data_update",
    "payload": {
      "servers": [
        {
          "id": "tranquility",
          "name": "晨曦",
          "build": 2798617,
          "version": "24.06",
          "createdAt": "2026-08-20T12:34:56Z"
        }
      ]
    }
  }'
```
