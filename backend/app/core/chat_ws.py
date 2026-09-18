# app/core/chat_ws.py
#
# Connection manager en memoria de proceso para el chat interno.
#
# N3: pasa de una conexión por CONVERSACIÓN a una conexión GLOBAL por
# USUARIO — antes el socket vivía y moría con la pantalla de chat abierta
# (ver endpoints/chat.py::chat_websocket en versiones previas), así que:
#   - Si estabas en /dashboard/schedule no había forma de saber en tiempo
#     real que te llegó un mensaje (solo el polling de
#     hooks/useChat.ts::useUnreadChatCount, cada 15-20s).
#   - No existía manera de saber si un mensaje realmente "le llegó" al
#     destinatario (para el segundo checkmark) — solo si estaba mirando
#     ESA conversación en ESE momento.
# Con una conexión por usuario (abierta apenas hay sesión, no por
# conversación — ver frontend/store/chatStore.ts) alcanza con saber
# si el USUARIO está online para:
#   1) marcar "entregado" (ver core/chat.py::mark_delivered_now /
#      catch_up_delivery), y
#   2) empujarle en tiempo real cualquier evento de CUALQUIER conversación
#      en la que participe, esté mirando esa pantalla o no.
#
# LIMITACIÓN CONOCIDA: esto asume una sola instancia del backend (hoy es
# el caso — un solo contenedor en Railway, ver railway.toml/Dockerfile,
# igual que core/cache.py). Si en el futuro escalan a 2+ instancias, un
# mensaje enviado a través de la instancia A nunca llegaría al socket de
# un usuario conectado a la instancia B.
#
# Camino de escalado ya planteado (no implementado): reemplazar el dict
# en memoria por un pub/sub de Redis — cada instancia se suscribe al
# canal `chat:user:{user_id}` y republica a sus sockets locales; el
# send_to_user()/broadcast_to_users() de abajo pasarían a hacer PUBLISH en
# vez de iterar _connections directamente. El resto de la lógica (auth,
# persistencia, autorización) no cambia.

import json
import logging
from collections import defaultdict
from fastapi import WebSocket

logger = logging.getLogger(__name__)


class ChatConnectionManager:
    def __init__(self) -> None:
        # user_id -> set(WebSocket) — un usuario puede tener varias
        # pestañas/dispositivos abiertos a la vez, todas reciben todo.
        self._connections: dict[int, set[WebSocket]] = defaultdict(set)

    async def connect(self, user_id: int, ws: WebSocket) -> None:
        await ws.accept()
        self._connections[user_id].add(ws)

    def disconnect(self, user_id: int, ws: WebSocket) -> None:
        sockets = self._connections.get(user_id)
        if not sockets:
            return
        sockets.discard(ws)
        if not sockets:
            self._connections.pop(user_id, None)

    def is_online(self, user_id: int) -> bool:
        return bool(self._connections.get(user_id))

    async def send_to_user(self, user_id: int, payload: dict) -> bool:
        """Manda el payload a TODAS las conexiones de ese usuario.
        Devuelve True si al menos un socket lo recibió (o sea, el usuario
        está "online" de verdad y no solo con un socket zombie)."""
        sockets = self._connections.get(user_id)
        if not sockets:
            return False
        data = json.dumps(payload, default=str)
        dead: list[WebSocket] = []
        delivered = False
        for ws in list(sockets):
            try:
                await ws.send_text(data)
                delivered = True
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(user_id, ws)
        return delivered

    async def broadcast_to_users(self, user_ids: set[int], payload: dict) -> set[int]:
        """Igual que send_to_user pero para varios usuarios (broadcast de
        un mensaje a todos los participantes de la conversación). Devuelve
        el subconjunto de user_ids que efectivamente estaba online."""
        delivered_to: set[int] = set()
        for user_id in user_ids:
            if await self.send_to_user(user_id, payload):
                delivered_to.add(user_id)
        return delivered_to


chat_manager = ChatConnectionManager()
