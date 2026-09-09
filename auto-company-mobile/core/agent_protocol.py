"""Agent communication protocol with states, threading, and handoff support."""
import asyncio
import json
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from typing import Any, Callable, Dict, List, Optional

from core.messaging import Message, MessageBus, Channel, MessageType


class AgentState(Enum):
    ACTIVE = "active"
    BUSY = "busy"
    OFFLINE = "offline"
    IN_CRISIS = "in_crisis"


@dataclass
class Thread:
    thread_id: str
    participants: List[str]
    messages: List[Message] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    status: str = "open"


class AgentProtocol:
    """Agent communication protocol implementing send/receive/broadcast with state management."""

    def __init__(self, agent_id: str, message_bus: MessageBus):
        self.agent_id = agent_id
        self.bus = message_bus
        self.state = AgentState.ACTIVE
        self._threads: Dict[str, Thread] = {}
        self._pending_requests: Dict[str, asyncio.Future] = {}
        self._response_handlers: Dict[str, Callable[[Message], Any]] = {}
        self._subscribed_channels: List[Channel] = []
        self._message_callback: Optional[Callable[[Message], Any]] = None

    async def start(self):
        self.bus.subscribe_agent(self.agent_id, self._on_message)
        self.bus.set_agent_online(self.agent_id)

    async def stop(self):
        self.bus.unsubscribe_agent(self.agent_id, self._on_message)
        self.bus.set_agent_offline(self.agent_id)
        self.state = AgentState.OFFLINE
        for future in self._pending_requests.values():
            if not future.done():
                future.cancel()
        self._pending_requests.clear()

    def set_state(self, state: AgentState):
        self.state = state
        if state == AgentState.OFFLINE:
            self.bus.set_agent_offline(self.agent_id)
        else:
            self.bus.set_agent_online(self.agent_id)

    async def send_message(self, to_agent: str, content: str, message_type: MessageType = MessageType.INFO,
                           priority: int = 5, ttl: Optional[float] = None,
                           reply_to: Optional[str] = None, thread_id: Optional[str] = None) -> str:
        if self.state == AgentState.OFFLINE:
            raise RuntimeError(f"Agent {self.agent_id} is offline")
        return await self.bus.direct_message(
            from_agent=self.agent_id,
            to_agent=to_agent,
            content=content,
            message_type=message_type,
            priority=priority,
            ttl=ttl,
            reply_to=reply_to,
            thread_id=thread_id,
        )

    async def receive_message(self, timeout: float = 5.0) -> Optional[Message]:
        if self.state == AgentState.OFFLINE:
            return None
        start = time.time()
        while time.time() - start < timeout:
            messages = await self.bus.get_unread(self.agent_id)
            if messages:
                return messages[0]
            await asyncio.sleep(0.05)
        return None

    async def broadcast_message(self, content: str, message_type: MessageType = MessageType.INFO,
                                 priority: int = 5, ttl: Optional[float] = None) -> str:
        if self.state == AgentState.OFFLINE:
            raise RuntimeError(f"Agent {self.agent_id} is offline")
        return await self.bus.broadcast(
            from_agent=self.agent_id,
            content=content,
            message_type=message_type,
            priority=priority,
            ttl=ttl,
        )

    async def request_response(self, to_agent: str, content: str, timeout: float = 30.0,
                               priority: int = 5) -> Optional[Message]:
        thread_id = str(uuid.uuid4())
        await self.bus.direct_message(
            from_agent=self.agent_id,
            to_agent=to_agent,
            content=content,
            message_type=MessageType.REQUEST,
            priority=priority,
            ttl=timeout,
            thread_id=thread_id,
        )
        # Poll the DB for a response with matching thread_id
        start = time.time()
        while time.time() - start < timeout:
            await asyncio.sleep(0.05)
            rows = self.bus._db.get_unread_messages(self.agent_id)
            for msg in rows:
                if msg.thread_id == thread_id and msg.message_type == MessageType.RESPONSE:
                    self.bus._db.update_message_status(msg.id, "delivered")
                    return msg
            # Also check thread
            rows2 = self.bus._db.get_thread(thread_id)
            for msg in rows2:
                if (msg.to_agent == self.agent_id
                        and msg.message_type == MessageType.RESPONSE
                        and msg.status not in ("expired", "delivered")):
                    self.bus._db.update_message_status(msg.id, "delivered")
                    return msg
        return None

    def subscribe_to_channel(self, channel: Channel):
        self._subscribed_channels.append(channel)
        self.bus.subscribe(channel, self._on_channel_message)

    def unsubscribe(self, channel: Channel):
        if channel in self._subscribed_channels:
            self._subscribed_channels.remove(channel)
            self.bus.unsubscribe(channel, self._on_channel_message)

    async def get_unread_messages(self, limit: int = 100) -> List[Message]:
        return await self.bus.get_unread(self.agent_id)

    async def mark_read(self, message_id: str):
        await self.bus.mark_read(self.agent_id, message_id)

    async def mark_all_read(self):
        await self.bus.mark_all_read(self.agent_id)

    def get_thread(self, thread_id: str) -> List[Message]:
        return self.bus._db.get_thread(thread_id)

    def create_thread(self, participants: List[str]) -> Thread:
        thread_id = str(uuid.uuid4())
        thread = Thread(thread_id=thread_id, participants=participants)
        self._threads[thread_id] = thread
        return thread

    async def handoff_to(self, target_agent: str, reason: str, state_data: Dict[str, Any]):
        content = json.dumps({
            "type": "handoff",
            "reason": reason,
            "state": state_data,
            "from_agent": self.agent_id,
        }, ensure_ascii=False)
        await self.bus.direct_message(
            from_agent=self.agent_id,
            to_agent=target_agent,
            content=content,
            message_type=MessageType.REQUEST,
            priority=1,
            channel=Channel.CRISIS_ALERT,
        )
        self.set_state(AgentState.OFFLINE)

    async def _on_message(self, message: Message):
        if message.thread_id and message.thread_id in self._pending_requests:
            future = self._pending_requests.pop(message.thread_id)
            if not future.done():
                future.set_result(message)
        if self._message_callback:
            result = self._message_callback(message)
            if asyncio.iscoroutine(result):
                await result

    async def _on_channel_message(self, message: Message):
        if message.thread_id and message.thread_id in self._pending_requests:
            future = self._pending_requests.pop(message.thread_id)
            if not future.done():
                future.set_result(message)

    def on_message(self, callback: Callable[[Message], Any]):
        self._message_callback = callback

    def get_state(self) -> str:
        return self.state.value


def json_dumps(obj: Dict[str, Any]) -> str:
    import json
    return json.dumps(obj, ensure_ascii=False)
