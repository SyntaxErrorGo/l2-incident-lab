# Примеры баг-репортов и JQL



## Баг 1: POST /api/orders возвращает 500 в режиме api_error

- **Заголовок:** `[Orders API] POST /api/orders возвращает HTTP 500 и не создаёт заказ`
- **Окружение:** local Docker Compose, backend 0.1.0, Nginx 1.27, PostgreSQL 16,
  Chrome 126, режим `api_error`.
- **Предусловия:** стек healthy; `/api/health` возвращает 200; включён `api_error`.
- **Шаги:** открыть Control Panel; создать заказ; повторить через curl с фиксированным
  `X-Request-ID`.
- **Фактический результат:** HTTP 500, `Simulated API error`, строки в PostgreSQL нет.
- **Ожидаемый результат:** HTTP 201, заказ со статусом `created` сохранён.
- **Частота воспроизведения:** 5/5, 100% при активном режиме.
- **Влияние:** блокируется создание всех новых заказов; severity Critical.
- **request_id:** `order-500-001`.
- **Логи и вложения:** backend ERROR и Nginx 500 из Kibana; curl output; HAR;
  Grafana Error rate/HTTP status codes; PostgreSQL empty result; ClickHouse
  `order_failed`; скриншот Control Panel.

## Баг 2: клиент получает 504, хотя заказ позднее создаётся

- **Заголовок:** `[Nginx/Orders] 504 через 3 секунды, backend завершает POST через 8 секунд`
- **Окружение:** local Docker Compose, Nginx `proxy_read_timeout=3s`, FastAPI,
  режим `slow_api`, Chrome 126.
- **Предусловия:** стек healthy; включён `slow_api`; известен уникальный payload.
- **Шаги:** отправить один POST с `X-Request-ID: order-slow-001`; дождаться 504;
  не повторять запрос; через 10 секунд проверить PostgreSQL.
- **Фактический результат:** клиент получает HTML 504 примерно через 3 s; backend
  выполняется около 8 s; заказ может появиться в БД после ответа клиенту.
- **Ожидаемый результат:** согласованный ответ без неопределённого исхода; повтор не
  должен создавать дубль.
- **Частота воспроизведения:** 5/5, 100% при активном режиме.
- **Влияние:** неопределённый результат и риск дублирования заказов; severity High.
- **request_id:** `order-slow-001`.
- **Логи и вложения:** HAR/Timing; Nginx `upstream timed out`; access log 504;
  backend duration ~8000 ms; строка PostgreSQL; ClickHouse timeline; Grafana p95;
  фрагмент nginx.conf.



