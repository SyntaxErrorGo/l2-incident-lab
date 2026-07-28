# Поиск логов L2 Incident Lab в Kibana

Откройте **Discover**, выберите data view **L2 Incident Lab Logs** и используйте KQL.

## По request_id

```kql
request_id : "example-request-001"
```

## Ошибки

```kql
level : "ERROR"
```

## HTTP 500

```kql
status_code : 500
```

## По сервису

```kql
service : "backend"
```

```kql
service : "nginx"
```

## По временному диапазону

Используйте time picker Kibana или KQL:

```kql
timestamp >= "now-15m" and timestamp <= "now"
```

## Корреляция ошибки

Сначала найдите Nginx-запись с `status_code : 500`, скопируйте `request_id`, затем выполните:

```kql
request_id : "скопированный-request-id"
```

## Bad Gateway 502

```kql
service : "nginx" and status_code : 502
```

Корреляция конкретного запроса:

```kql
request_id : "order-502-001"
```

Для 502 запись обработки `POST /api/orders` в backend отсутствует: Nginx не смог
соединиться с upstream. Backend может содержать только внутреннюю проверку режима с
тем же request_id.

Access-событие содержит `request_id` и `upstream_addr`. Стандартная строка Nginx
error log с `connection refused` не содержит входной request_id, поэтому её связывают
с access-событием по времени, URI и upstream.

## Too Many Requests 429

```kql
service : "backend" and level : "WARNING" and status_code : 429
```

```kql
request_id : "order-429-001"
```
