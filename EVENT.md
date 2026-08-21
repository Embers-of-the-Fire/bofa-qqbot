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
