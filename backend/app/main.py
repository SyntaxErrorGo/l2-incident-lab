import logging
import time
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import Depends, FastAPI, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from .analytics import analytics
from .database import Base, engine, get_db
from .incidents import INCIDENT_MODES, IncidentMode, incident_state
from .logging_config import configure_logging
from .metrics import (
    HTTP_ERRORS,
    HTTP_REQUEST_DURATION,
    HTTP_REQUESTS,
    ORDERS_CREATED,
    set_incident_mode,
)
from .models import Order, OrderStatusHistory
from .schemas import OrderCreate, OrderResponse


configure_logging()
logger = logging.getLogger("incident_lab.api")


@asynccontextmanager
async def lifespan(_: FastAPI):
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS request_id VARCHAR(128)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_request_id ON orders (request_id)"))
    Base.metadata.create_all(bind=engine)
    yield


app = FastAPI(title="L2 Incident Lab", version="0.1.0", lifespan=lifespan)


@app.middleware("http")
async def request_context(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID") or str(uuid4())
    request.state.request_id = request_id
    started_at = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        logger.exception(
            "Unhandled request error",
            extra={"request_id": request_id, "method": request.method, "path": request.url.path},
        )
        response = Response(content='{"detail":"Internal Server Error"}', status_code=500, media_type="application/json")

    response.headers["X-Request-ID"] = request_id
    duration = time.perf_counter() - started_at
    route = request.scope.get("route")
    path = getattr(route, "path", request.url.path)
    metric_labels = {
        "method": request.method,
        "path": path,
        "status_code": str(response.status_code),
    }
    HTTP_REQUESTS.labels(**metric_labels).inc()
    HTTP_REQUEST_DURATION.labels(method=request.method, path=path).observe(duration)
    if response.status_code >= 400:
        HTTP_ERRORS.labels(**metric_labels).inc()
    analytics.emit(
        "request_completed",
        request_id,
        status_code=response.status_code,
        duration_ms=round(duration * 1000, 2),
        incident_mode=incident_state.get(),
    )
    logger.info(
        "Request completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round(duration * 1000, 2),
        },
    )
    return response


@app.get("/api/health")
def health(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok", "database": "ok"}


@app.get("/metrics", include_in_schema=False)
def metrics():
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


@app.post("/api/orders", response_model=OrderResponse, status_code=status.HTTP_201_CREATED)
def create_order(request: Request, payload: OrderCreate, db: Session = Depends(get_db)):
    mode = incident_state.get()
    log_context = {
        "request_id": request.state.request_id,
        "event": "incident_effect",
        "mode": mode,
    }

    if mode == "api_error":
        logger.error("Simulated order API failure", extra=log_context)
        analytics.emit(
            "order_failed",
            request.state.request_id,
            status_code=500,
            incident_mode=mode,
        )
        raise HTTPException(status_code=500, detail="Simulated API error")

    if mode == "rate_limited":
        logger.warning(
            "Order creation rate limit exceeded",
            extra={
                **log_context,
                "status_code": 429,
                "reason": "Too many order creation requests; retry after 30 seconds",
            },
        )
        analytics.emit(
            "order_failed",
            request.state.request_id,
            status_code=429,
            incident_mode=mode,
        )
        return JSONResponse(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            headers={"Retry-After": "30"},
            content={
                "detail": "Too many order creation requests",
                "retry_after_seconds": 30,
            },
        )

    if mode == "slow_api":
        logger.warning("Simulating slow order API", extra=log_context)
        time.sleep(8)

    order_status = "UNKNOWN" if mode == "invalid_status" else "created"
    order = Order(
        **payload.model_dump(),
        status=order_status,
        request_id=request.state.request_id,
    )
    try:
        db.add(order)
        db.flush()
        db.add(
            OrderStatusHistory(
                order_id=order.id,
                old_status=None,
                new_status=order_status,
                request_id=request.state.request_id,
            )
        )
        db.commit()
        db.refresh(order)
    except Exception:
        db.rollback()
        analytics.emit(
            "order_failed",
            request.state.request_id,
            status_code=500,
            incident_mode=mode,
        )
        raise
    ORDERS_CREATED.labels(status=order.status).inc()
    analytics.emit(
        "order_created",
        request.state.request_id,
        order_id=order.id,
        status_code=status.HTTP_201_CREATED,
        incident_mode=mode,
    )
    if mode == "invalid_status":
        logger.warning(
            "Order saved with invalid status",
            extra={**log_context, "order_id": order.id},
        )
    return order


@app.get("/api/orders", response_model=list[OrderResponse])
def list_orders(db: Session = Depends(get_db)):
    return db.scalars(select(Order).order_by(Order.id.desc())).all()


@app.get("/api/incidents/status")
def incident_status():
    return {"mode": incident_state.get()}


@app.get("/api/incidents/proxy-route", include_in_schema=False)
def incident_proxy_route():
    """Internal Nginx subrequest: expose routing mode without changing the order API."""
    return Response(status_code=204, headers={"X-Incident-Mode": incident_state.get()})


@app.post("/api/incidents/reset")
def reset_incident(request: Request):
    return change_incident_mode(request, "normal")


@app.post("/api/incidents/{mode}")
def activate_incident(mode: str, request: Request):
    if mode not in INCIDENT_MODES:
        raise HTTPException(
            status_code=422,
            detail={"message": "Unknown incident mode", "allowed_modes": sorted(INCIDENT_MODES)},
        )
    return change_incident_mode(request, mode)


def change_incident_mode(request: Request, mode: IncidentMode):
    previous_mode = incident_state.set(mode)
    set_incident_mode(mode)
    logger.warning(
        "Incident mode changed",
        extra={
            "request_id": request.state.request_id,
            "event": "incident_mode_changed",
            "mode": mode,
            "previous_mode": previous_mode,
        },
    )
    analytics.emit(
        "incident_reset" if mode == "normal" else "incident_enabled",
        request.state.request_id,
        status_code=200,
        incident_mode=mode,
    )
    return {"mode": mode, "previous_mode": previous_mode}
