# app/core/chat_ws.py
#
# Connection manager en memoria de proceso para el chat interno.
#
# LIMITACIÓN CONOCIDA: esto asume una sola instancia del backend (hoy es
# el caso — un solo contenedor en Railway, ver railway.toml/Dockerfile,
# igual que core/cache.py). Si en el futuro escalan a 2+ instancias, un
# mensaje enviado a través de la instancia A nunca llegaría al socket de
# un usuario conectado a la instancia B.
#
# Camino de escalado ya planteado (no implementado): reemplazar el dict
# en memoria por un pub/sub de Redis — cada instancia se suscribe al
# canal `chat:{conversation_id}` y republica a sus sockets locales; el
# broadcast() de abajo pasaría a hacer PUBLISH en vez de iterar
# _connections directamente. El resto de la lógica (auth, persistencia,
# autorización) no cambia.

import json
import logging
from collections import defaultdict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ChatConnectionManager:
    def __init__(self) -> None:
        # conversation_id -> {user_id -> set(WebSocket)}  (un usuario puede
        # tener varias pestañas/dispositivos abiertos a la vez)
        self._connections: dict[int, dict[int, set[WebSocket]]] = defaultdict(
            lambda: defaultdict(set)
        )

    async def connect(self, conversation_id: int, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[conversation_id][user_id].add(ws)

    def disconnect(self, conversation_id: int, user_id: int, ws: WebSocket) -> None:
        conns = self._connections.get(conversation_id)
        if not conns:
            return
        sockets = conns.get(user_id)
        if sockets:
            sockets.discard(ws)
            if not sockets:
                del conns[user_id]
        if not conns:
            self._connections.pop(conversation_id, None)

    async def broadcast(self, conversation_id: int, payload: dict) -> None:
        conns = self._connections.get(conversation_id)
        if not conns:
            return
        data = json.dumps(payload, default=str)
        dead: list[tuple[int, WebSocket]] = []
        for user_id, sockets in conns.items():
            for ws in sockets:
                try:
                    await ws.send_text(data)
                except Exception:
                    dead.append((user_id, ws))
        for user_id, ws in dead:
            self.disconnect(conversation_id, user_id, ws)


chat_manager = ChatConnectionManager()
