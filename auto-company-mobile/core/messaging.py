"""Agent-to-agent messaging bus with pub/sub, TTL, persistence, and priority delivery."""
import asyncio
import sqlite3
import time
import uuid
from dataclasses import dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, Set


class Channel(Enum):
    BROADCAST = "broadcast"
    DIRECT_MESSAGE = "direct_message"
    SKILL_REQUEST = "skill_request"
    SKILL_RESPONSE = "skill_response"
    CRISIS_ALERT = "crisis_alert"
    CONSENSUS_UPDATE = "consensus_update"
    FEEDBACK = "feedback"
    LOG = "log"


class MessageType(Enum):
    REQUEST = "request"
    RESPONSE = "response"
    INFO = "info"
    WARNING = "warning"
    ERROR = "error"
    PROPOSAL = "proposal"
    DECISION = "decision"


@dataclass
class Message:
    id: str = field(default_factory=lambda: str(uuid.uuid4()))
    from_agent: str = ""
    to_agent: str = ""
    channel: Channel = Channel.DIRECT_MESSAGE
    message_type: MessageType = MessageType.INFO
    content: str = ""
    priority: int = 5
    timestamp: float = field(default_factory=time.time)
    reply_to: Optional[str] = None
    status: str = "pending"
    ttl: Optional[float] = None
    thread_id: Optional[str] = None

    def is_expired(self) -> bool:
        if self.ttl is None:
            return False
        return time.time() > self.timestamp + self.ttl

    def to_dict(self) -> Dict[str, Any]:
        return {
            "id": self.id,
            "from_agent": self.from_agent,
            "to_agent": self.to_agent,
            "channel": self.channel.value,
            "message_type": self.message_type.value,
            "content": self.content,
            "priority": self.priority,
            "timestamp": self.timestamp,
            "reply_to": self.reply_to,
            "status": self.status,
            "ttl": self.ttl,
            "thread_id": self.thread_id,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Message":
        return cls(
            id=data.get("id", str(uuid.uuid4())),
            from_agent=data.get("from_agent", ""),
            to_agent=data.get("to_agent", ""),
            channel=Channel(data.get("channel", Channel.DIRECT_MESSAGE.value)),
            message_type=MessageType(data.get("message_type", MessageType.INFO.value)),
            content=data.get("content", ""),
            priority=data.get("priority", 5),
            timestamp=data.get("timestamp", time.time()),
            reply_to=data.get("reply_to"),
            status=data.get("status", "pending"),
            ttl=data.get("ttl"),
            thread_id=data.get("thread_id"),
        )


class MessageDatabase:
    """SQLite-backed message persistence."""

    def __init__(self, db_path: str = "state/messages.db"):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._init_db()

    def _init_db(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    from_agent TEXT NOT NULL,
                    to_agent TEXT NOT NULL,
                    channel TEXT NOT NULL,
                    message_type TEXT NOT NULL,
                    content TEXT NOT NULL,
                    priority INTEGER NOT NULL,
                    timestamp REAL NOT NULL,
                    reply_to TEXT,
                    status TEXT NOT NULL,
                    ttl REAL,
                    thread_id TEXT
                )
            """)
            conn.execute("""
                CREATE TABLE IF NOT EXISTS offline_queues (
                    agent_id TEXT NOT NULL,
                    message_id TEXT NOT NULL,
                    PRIMARY KEY (agent_id, message_id)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_to_agent ON messages(to_agent)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp)")

    def insert_message(self, message: Message):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                """INSERT OR REPLACE INTO messages 
                   (id, from_agent, to_agent, channel, message_type, content, priority, timestamp, reply_to, status, ttl, thread_id)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    message.id,
                    message.from_agent,
                    message.to_agent,
                    message.channel.value,
                    message.message_type.value,
                    message.content,
                    message.priority,
                    message.timestamp,
                    message.reply_to,
                    message.status,
                    message.ttl,
                    message.thread_id,
                ),
            )

    def update_message_status(self, message_id: str, status: str):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("UPDATE messages SET status = ? WHERE id = ?", (status, message_id))

    def get_unread_messages(self, agent_id: str, limit: int = 100) -> List[Message]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                """SELECT * FROM messages 
                   WHERE to_agent = ? AND status = 'pending' 
                   AND (ttl IS NULL OR timestamp + ttl > ?)
                   ORDER BY priority ASC, timestamp ASC
                   LIMIT ?""",
                (agent_id, time.time(), limit),
            ).fetchall()
        cols = [d[1] for d in conn.execute("PRAGMA table_info(messages)").fetchall()]
        return [Message.from_dict(dict(zip(cols, r, strict=False))) for r in rows]

    def get_message(self, message_id: str) -> Optional[Message]:
        with sqlite3.connect(self.db_path) as conn:
            row = conn.execute("SELECT * FROM messages WHERE id = ?", (message_id,)).fetchone()
        if not row:
            return None
        cols = [d[1] for d in conn.execute("PRAGMA table_info(messages)").fetchall()]
        return Message.from_dict(dict(zip(cols, row, strict=False)))

    def get_thread(self, thread_id: str) -> List[Message]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE thread_id = ? OR id = ? ORDER BY timestamp ASC",
                (thread_id, thread_id),
            ).fetchall()
        cols = [d[1] for d in conn.execute("PRAGMA table_info(messages)").fetchall()]
        return [Message.from_dict(dict(zip(cols, r, strict=False))) for r in rows]

    def queue_offline_message(self, agent_id: str, message_id: str):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "INSERT OR IGNORE INTO offline_queues (agent_id, message_id) VALUES (?, ?)",
                (agent_id, message_id),
            )

    def get_offline_messages(self, agent_id: str) -> List[str]:
        with sqlite3.connect(self.db_path) as conn:
            rows = conn.execute(
                "SELECT message_id FROM offline_queues WHERE agent_id = ?", (agent_id,)
            ).fetchall()
        return [r[0] for r in rows]

    def clear_offline_queue(self, agent_id: str):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("DELETE FROM offline_queues WHERE agent_id = ?", (agent_id,))

    def purge_expired(self):
        with sqlite3.connect(self.db_path) as conn:
            conn.execute(
                "DELETE FROM messages WHERE ttl IS NOT NULL AND timestamp + ttl <= ?",
                (time.time(),),
            )


class MessageBus:
    """Async pub/sub message bus with priority routing and offline queuing."""

    def __init__(self, db_path: str = "state/messages.db"):
        self._db = MessageDatabase(db_path)
        self._subscribers: Dict[Channel, List[Callable[[Message], Any]]] = {}
        self._agent_subscribers: Dict[str, List[Callable[[Message], Any]]] = {}
        self._direct_queues: Dict[str, "asyncio.PriorityQueue[Message]"] = {}
        self._broadcast_queues: Dict[str, "asyncio.PriorityQueue[Message]"] = {}
        self._offline_agents: Set[str] = set()
        self._lock = asyncio.Lock()
        # Helper to schedule coroutines on the background loop from any thread
        def _run_coroutine_threadsafe(self, coro):
            """Schedule *coro* on the consumer thread's event loop and return a Future.
            Caller can wait on ``future.result()`` to block until completion.
            """
            if not hasattr(self, "_loop"):
                raise RuntimeError("MessageBus not started; no event loop available")
            return asyncio.run_coroutine_threadsafe(coro, self._loop)
        # Bind the helper as an instance method
        import types
        self._run_coroutine_threadsafe = types.MethodType(_run_coroutine_threadsafe, self)

        async def _create_queues(self, agent_id: str):
            """Create direct and broadcast queues for *agent_id* on the background loop."""
            self._direct_queues[agent_id] = asyncio.PriorityQueue()
            self._broadcast_queues[agent_id] = asyncio.PriorityQueue()
        self._create_queues = types.MethodType(_create_queues, self)

        async def _enqueue_direct(self, message: Message):
            """Enqueue a direct message onto the appropriate queue in the background loop."""
            q = self._direct_queues.get(message.to_agent)
            if q:
                self._seq += 1
                await q.put((message.priority, self._seq, message))
            else:
                # No queue for this agent — message stays in DB as pending
                # (will be retrieved via get_unread by the recipient later)
                pass
        self._enqueue_direct = types.MethodType(_enqueue_direct, self)

        self._running = False
        self._consumer_task: Optional[asyncio.Task] = None
        self._seq = 0

    async def start(self):
        """Start the consumer loop in a background thread.
        This matches the test usage where ``run(self.bus.start())`` is called.
        We spin up a dedicated asyncio event loop in a separate daemon thread
        and schedule the ``_consume_loop`` coroutine there. All async primitives
        (queues, locks) will be created on that loop, avoiding cross‑loop errors.
        """
        if self._running:
            return
        self._running = True
        # Dedicated event loop for the consumer thread
        self._loop = asyncio.new_event_loop()
        import threading
        def _run_loop():
            asyncio.set_event_loop(self._loop)
            # Consumer task runs forever until stopped
            self._consumer_task = self._loop.create_task(self._consume_loop())
            self._loop.run_forever()
        self._thread = threading.Thread(target=_run_loop, daemon=True)
        self._thread.start()
        self._db.purge_expired()

    async def stop(self):
        # Signal shutdown to the consumer loop
        self._running = False
        # Cancel the consumer task safely on its own loop if it exists
        loop = getattr(self, "_loop", None)
        if loop is not None and loop.is_running():
            consumer_task = getattr(self, "_consumer_task", None)
            if consumer_task:
                loop.call_soon_threadsafe(lambda: consumer_task.cancel())
            loop.call_soon_threadsafe(loop.stop)
        thread = getattr(self, "_thread", None)
        if thread is not None:
            thread.join(timeout=5)
        # Clean up references
        self._loop = None
        self._thread = None
        self._consumer_task = None

    def subscribe(self, channel: Channel, callback: Callable[[Message], Any]):
        self._subscribers.setdefault(channel, []).append(callback)

    def unsubscribe(self, channel: Channel, callback: Callable[[Message], Any]):
        if channel in self._subscribers:
            self._subscribers[channel] = [cb for cb in self._subscribers[channel] if cb != callback]

    def subscribe_agent(self, agent_id: str, callback: Callable[[Message], Any]):
        self._agent_subscribers.setdefault(agent_id, []).append(callback)
        loop = getattr(self, "_loop", None)
        if loop is not None and agent_id not in self._direct_queues:
            # Ensure queues are created on the background event loop
            future = self._run_coroutine_threadsafe(self._create_queues(agent_id))
            future.result()

    def unsubscribe_agent(self, agent_id: str, callback: Callable[[Message], Any]):
        if agent_id in self._agent_subscribers:
            self._agent_subscribers[agent_id] = [
                cb for cb in self._agent_subscribers[agent_id] if cb != callback
            ]

    async def send(self, message: Message) -> str:
        if message.is_expired():
            message.status = "expired"
            self._db.insert_message(message)
            return message.id

        if message.channel == Channel.BROADCAST:
            message.to_agent = "*"
        elif message.channel == Channel.DIRECT_MESSAGE and not message.to_agent:
            raise ValueError("Direct messages require a to_agent")

        message.status = "pending"
        self._db.insert_message(message)

        async with self._lock:
            if message.to_agent and message.to_agent != "*":
                if message.to_agent in self._offline_agents:
                    self._db.queue_offline_message(message.to_agent, message.id)
                else:
                    # Schedule direct enqueue on the consumer loop
                    future = self._run_coroutine_threadsafe(self._enqueue_direct(message))
                    future.result()
            if message.channel == Channel.BROADCAST:
                # Schedule broadcast enqueue on the consumer loop
                async def _broadcast():
                    for agent_id, q in self._broadcast_queues.items():
                        if agent_id != message.from_agent:
                            self._seq += 1
                            await q.put((message.priority, self._seq, message))
                future = self._run_coroutine_threadsafe(_broadcast())
                future.result()
                for cb in self._subscribers.get(Channel.BROADCAST, []):
                    try:
                        result = cb(message)
                        if asyncio.iscoroutine(result):
                            await result
                    except Exception:
                        pass

        return message.id

    async def broadcast(self, from_agent: str, content: str, message_type: MessageType = MessageType.INFO,
                        priority: int = 5, ttl: Optional[float] = None) -> str:
        message = Message(
            from_agent=from_agent,
            to_agent="*",
            channel=Channel.BROADCAST,
            message_type=message_type,
            content=content,
            priority=priority,
            ttl=ttl,
        )
        return await self.send(message)

    async def direct_message(self, from_agent: str, to_agent: str, content: str,
                              message_type: MessageType = MessageType.INFO, priority: int = 5,
                              ttl: Optional[float] = None, reply_to: Optional[str] = None,
                              thread_id: Optional[str] = None, channel: Optional[Channel] = None) -> str:
        message = Message(
            from_agent=from_agent,
            to_agent=to_agent,
            channel=channel or Channel.DIRECT_MESSAGE,
            message_type=message_type,
            content=content,
            priority=priority,
            ttl=ttl,
            reply_to=reply_to,
            thread_id=thread_id,
        )
        return await self.send(message)

    async def request_response(self, from_agent: str, to_agent: str, content: str,
                                timeout: float = 30.0, priority: int = 5) -> Optional[Message]:
        thread_id = str(uuid.uuid4())
        await self.direct_message(
            from_agent=from_agent,
            to_agent=to_agent,
            content=content,
            message_type=MessageType.REQUEST,
            priority=priority,
            ttl=timeout,
            thread_id=thread_id,
        )
        start = time.time()
        while time.time() - start < timeout:
            await asyncio.sleep(0.05)
            rows = self._db.get_unread_messages(from_agent, limit=100)
            for msg in rows:
                if msg.thread_id == thread_id and msg.message_type == MessageType.RESPONSE:
                    self._db.update_message_status(msg.id, "delivered")
                    return msg
            rows = self._db.get_thread(thread_id)
            for msg in rows:
                if msg.to_agent == from_agent and msg.message_type == MessageType.RESPONSE and msg.status != "expired":
                    self._db.update_message_status(msg.id, "delivered")
                    return msg
        return None

    async def get_unread(self, agent_id: str) -> List[Message]:
        # Retrieve direct messages addressed to this agent
        direct = self._db.get_unread_messages(agent_id)
        # Retrieve broadcast messages (to_agent='*')
        broadcast = self._db.get_unread_messages("*")
        # Combine and mark all as delivered
        for msg in direct + broadcast:
            self._db.update_message_status(msg.id, "delivered")
        # Return sorted by priority then timestamp
        return sorted(direct + broadcast, key=lambda m: (m.priority, m.timestamp))

    async def mark_read(self, agent_id: str, message_id: str):
        self._db.update_message_status(message_id, "read")

    async def mark_all_read(self, agent_id: str):
        messages = self._db.get_unread_messages(agent_id)
        for msg in messages:
            self._db.update_message_status(msg.id, "read")

    def set_agent_online(self, agent_id: str):
        self._offline_agents.discard(agent_id)
        if agent_id in self._direct_queues:
            try:
                asyncio.get_running_loop()
                asyncio.create_task(self._flush_offline_messages(agent_id))
            except RuntimeError:
                pass

    def set_agent_offline(self, agent_id: str):
        self._offline_agents.add(agent_id)

    async def _flush_offline_messages(self, agent_id: str):
        offline_ids = self._db.get_offline_messages(agent_id)
        for msg_id in offline_ids:
            msg = self._db.get_message(msg_id)
            if msg and not msg.is_expired():
                q = self._direct_queues.get(agent_id)
                if q:
                    self._seq += 1
                    await q.put((msg.priority, self._seq, msg))
        self._db.clear_offline_queue(agent_id)

    async def _consume_loop(self):
        while self._running:
            for agent_id, q in list(self._direct_queues.items()):
                if agent_id in self._offline_agents:
                    continue
                try:
                    _, _, msg = q.get_nowait()
                except asyncio.QueueEmpty:
                    continue
                if msg.is_expired():
                    msg.status = "expired"
                    self._db.update_message_status(msg.id, "expired")
                    continue
                await self._deliver(msg, agent_id)
            for agent_id, q in list(self._broadcast_queues.items()):
                if agent_id in self._offline_agents:
                    continue
                try:
                    _, _, msg = q.get_nowait()
                except asyncio.QueueEmpty:
                    continue
                if msg.is_expired():
                    msg.status = "expired"
                    self._db.update_message_status(msg.id, "expired")
                    continue
                await self._deliver(msg, agent_id)
            await asyncio.sleep(0.01)

    async def _deliver(self, message: Message, agent_id: str):
        message.status = "delivered"
        self._db.update_message_status(message.id, "delivered")
        callbacks = self._agent_subscribers.get(agent_id, [])
        for cb in callbacks:
            try:
                result = cb(message)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass
        channel_callbacks = self._subscribers.get(message.channel, [])
        for cb in channel_callbacks:
            try:
                result = cb(message)
                if asyncio.iscoroutine(result):
                    await result
            except Exception:
                pass

    def get_agent_state(self, agent_id: str) -> str:
        if agent_id in self._offline_agents:
            return "offline"
        if agent_id in self._direct_queues:
            return "online"
        return "unknown"

    def get_channel_stats(self) -> Dict[str, int]:
        stats: Dict[str, int] = {}
        for agent_id, q in self._direct_queues.items():
            stats[f"direct_queue_{agent_id}"] = q.qsize()
        for agent_id, q in self._broadcast_queues.items():
            stats[f"broadcast_queue_{agent_id}"] = q.qsize()
        return stats
