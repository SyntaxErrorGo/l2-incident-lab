from threading import RLock
from typing import Literal, get_args


IncidentMode = Literal[
    "normal",
    "api_error",
    "slow_api",
    "invalid_status",
    "bad_gateway",
    "rate_limited",
]
INCIDENT_MODES = set(get_args(IncidentMode))


class IncidentState:
    def __init__(self) -> None:
        self._mode: IncidentMode = "normal"
        self._lock = RLock()

    def get(self) -> IncidentMode:
        with self._lock:
            return self._mode

    def set(self, mode: IncidentMode) -> IncidentMode:
        with self._lock:
            previous_mode = self._mode
            self._mode = mode
            return previous_mode


incident_state = IncidentState()
