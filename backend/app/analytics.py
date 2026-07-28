import base64
import json
import logging
import os
from datetime import datetime, timezone
from queue import Full, Queue
from threading import Thread
from urllib.parse import urlencode
from urllib.request import Request, urlopen


logger = logging.getLogger("incident_lab.analytics")


class ClickHouseAnalytics:
    def __init__(self) -> None:
        self.url = os.getenv("CLICKHOUSE_URL", "http://clickhouse:8123")
        self.database = os.getenv("CLICKHOUSE_DATABASE", "incident_lab")
        self.user = os.getenv("CLICKHOUSE_USER", "incident")
        self.password = os.getenv("CLICKHOUSE_PASSWORD", "incident")
        self.events: Queue[dict] = Queue(maxsize=10_000)
        Thread(target=self._run, name="clickhouse-analytics", daemon=True).start()

    def emit(
        self,
        event_type: str,
        request_id: str,
        *,
        order_id: int | None = None,
        status_code: int = 0,
        duration_ms: float = 0,
        incident_mode: str = "normal",
    ) -> None:
        event = {
            "event_time": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S.%f")[:-3],
            "event_type": event_type,
            "request_id": request_id,
            "order_id": order_id,
            "status_code": status_code,
            "duration_ms": duration_ms,
            "incident_mode": incident_mode,
        }
        try:
            self.events.put_nowait(event)
        except Full:
            logger.error(
                "ClickHouse analytics queue is full",
                extra={
                    "request_id": request_id,
                    "event": "analytics_write_failed",
                    "event_type": event_type,
                },
            )

    def _run(self) -> None:
        while True:
            event = self.events.get()
            try:
                self._write(event)
            except Exception:
                logger.exception(
                    "ClickHouse analytics write failed",
                    extra={
                        "request_id": event["request_id"],
                        "event": "analytics_write_failed",
                        "event_type": event["event_type"],
                    },
                )
            finally:
                self.events.task_done()

    def _write(self, event: dict) -> None:
        query = f"INSERT INTO {self.database}.analytics_events FORMAT JSONEachRow"
        request = Request(
            f"{self.url}/?{urlencode({'query': query})}",
            data=(json.dumps(event, ensure_ascii=False) + "\n").encode(),
            headers={
                "Authorization": "Basic "
                + base64.b64encode(f"{self.user}:{self.password}".encode()).decode(),
                "Content-Type": "application/x-ndjson",
            },
            method="POST",
        )
        with urlopen(request, timeout=1) as response:
            if response.status >= 300:
                raise RuntimeError(f"ClickHouse returned HTTP {response.status}")


analytics = ClickHouseAnalytics()

