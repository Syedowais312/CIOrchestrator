import asyncio
from typing import Any

from fastapi import WebSocket

from storage import add_event


class EventBus:
    def __init__(self) -> None:
        self.connections: set[WebSocket] = set()
        self.history: dict[str, list[dict[str, Any]]] = {}
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        self.connections.discard(websocket)

    async def publish(self, diagnosis_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            self.history.setdefault(diagnosis_id, []).append(event)
        add_event(
            diagnosis_id,
            event.get("agent", "system"),
            event.get("status", ""),
            event.get("data", {}),
        )

        stale: list[WebSocket] = []
        for connection in self.connections:
            try:
                await connection.send_json(event)
            except Exception:
                stale.append(connection)

        for connection in stale:
            self.disconnect(connection)


event_bus = EventBus()
