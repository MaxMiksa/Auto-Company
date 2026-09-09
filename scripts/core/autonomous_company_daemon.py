import asyncio
import os
import socket
import json
import functools
import sys
from pathlib import Path
from datetime import datetime

ROOT_DIR = Path(__file__).resolve().parent.parent.parent
CONSENSUS_FILE = ROOT_DIR / "memories" / "consensus.md"
DAEMON_LOG = ROOT_DIR / "logs" / "autonomous_daemon.log"
PAUSE_FILE = ROOT_DIR / ".swarm_paused"
ENV_FILE = ROOT_DIR / ".env.omniroute"

GROQ_API_KEY = None
if ENV_FILE.exists():
    for line in ENV_FILE.read_text().splitlines():
        if line.startswith("GROQ_API_KEY="):
            GROQ_API_KEY = line.split("=", 1)[1].strip()

# Модели
# Keep the decoupled swarm configurable and aligned with the model inventory;
# operators can override IDs without editing the daemon or its queues.
LOCAL_FAST_MODEL = os.getenv("AUTO_COMPANY_SWARM_FAST_MODEL", "qwen2.5-coder-7b-instruct")
LOCAL_HEAVY_MODEL = os.getenv("AUTO_COMPANY_SWARM_HEAVY_MODEL", "huihui-qwen3.8-27b-abliterated")
CLOUD_HEAVY_MODEL = os.getenv("AUTO_COMPANY_SWARM_CLOUD_MODEL", "openai/gpt-oss-120b")

# Keep all persona budgets explicit.  These are wall-clock request budgets in
# seconds (not model TTLs): cloud calls are short, GPU calls are interactive,
# and CPU inference is allowed to use the long lane.  Operators can tune each
# lane without editing the daemon.
TIMEOUT_PROFILES = {
    "cloud": 70.0,
    "gpu": 120.0,
    "cpu": 360.0,
}
try:
    GPU_BUDGET_GIB = float(os.getenv("AUTO_COMPANY_SWARM_GPU_BUDGET_GIB", "8"))
    if not (0 < GPU_BUDGET_GIB <= 11):
        GPU_BUDGET_GIB = 8.0
except ValueError:
    GPU_BUDGET_GIB = 8.0
for _lane, _default in tuple(TIMEOUT_PROFILES.items()):
    _raw = os.getenv(f"AUTO_COMPANY_SWARM_TIMEOUT_{_lane.upper()}")
    if _raw is not None:
        try:
            _value = float(_raw)
            if 0 < _value <= 3600:
                TIMEOUT_PROFILES[_lane] = _value
        except ValueError:
            pass


def _timeout_for(target: str, online: bool) -> float:
    """Resolve a bounded timeout before any provider request is made."""
    lane = "cloud" if target == "CLOUD_IF_ONLINE" and online else (
        "cpu" if target == "LOCAL_CPU" else "gpu"
    )
    return TIMEOUT_PROFILES[lane]


def choose_local_lane(estimated_gpu_gib):
    """Choose a local lane without starting a model or exhausting VRAM."""
    try:
        estimate = float(estimated_gpu_gib)
    except (TypeError, ValueError):
        return "LOCAL_CPU"
    return "LOCAL_GPU" if 0 <= estimate <= GPU_BUDGET_GIB else "LOCAL_CPU"


def _env_number(name, default, *, minimum=None, maximum=None, integer=False):
    """Parse daemon tuning values without allowing malformed env to crash it."""
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw) if integer else float(raw)
    except (TypeError, ValueError):
        return default
    if minimum is not None and value < minimum:
        return default
    if maximum is not None and value > maximum:
        return default
    return value


def build_canonical_swarm_bridge():
    """Build an opt-in bridge; legacy queue behavior remains unchanged by default."""
    enabled = os.getenv("AUTO_COMPANY_CANONICAL_ENABLED", "").lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return None
    root = os.getenv("AUTO_COMPANY_CANONICAL_ROOT")
    registry = os.getenv("AUTO_COMPANY_PROJECT_REGISTRY")
    project_id = os.getenv("AUTO_COMPANY_PROJECT_ID")
    if not root or not registry or not project_id:
        raise RuntimeError("canonical swarm mode requires AUTO_COMPANY_CANONICAL_ROOT, AUTO_COMPANY_PROJECT_REGISTRY and AUTO_COMPANY_PROJECT_ID")
    root_path = Path(root).resolve()
    if not (root_path / "core" / "swarm_bridge.py").is_file():
        raise RuntimeError("canonical swarm root does not contain core/swarm_bridge.py")
    if str(root_path) not in sys.path:
        sys.path.insert(0, str(root_path))
    from core.legacy_bridge import build_registry_bridge
    from core.swarm_bridge import SwarmBridge
    return SwarmBridge(build_registry_bridge(registry, project_id).runtime)


def build_canonical_cycle_bridge():
    """Build the planner->queue->evidence bridge for opt-in daemon cycles.

    This is deliberately separate from ``build_canonical_swarm_bridge``:
    callers that still exchange legacy swarm messages can keep that adapter,
    while the autonomous daemon gets the full durable planner cycle.
    """
    enabled = os.getenv("AUTO_COMPANY_CANONICAL_ENABLED", "").lower() in {"1", "true", "yes", "on"}
    if not enabled:
        return None
    root = os.getenv("AUTO_COMPANY_CANONICAL_ROOT")
    registry = os.getenv("AUTO_COMPANY_PROJECT_REGISTRY")
    project_id = os.getenv("AUTO_COMPANY_PROJECT_ID")
    if not root or not registry or not project_id:
        raise RuntimeError("canonical cycle requires AUTO_COMPANY_CANONICAL_ROOT, AUTO_COMPANY_PROJECT_REGISTRY and AUTO_COMPANY_PROJECT_ID")
    root_path = Path(root).resolve()
    if str(root_path) not in sys.path:
        sys.path.insert(0, str(root_path))
    from core.legacy_bridge import build_registry_bridge
    return build_registry_bridge(registry, project_id,
                                 state_dir=os.getenv("AUTO_COMPANY_CANONICAL_STATE_DIR"))


async def run_canonical_daemon_once(bridge, objective: str, *, feedback: str = "",
                                    max_tasks: int = 1, allow_git_commit: bool = False):
    """Run one complete planner -> durable queue -> verified review cycle."""
    if bridge is None:
        raise RuntimeError("canonical cycle bridge is not configured")
    if not objective or not objective.strip():
        raise ValueError("canonical daemon objective must be non-empty")
    return await bridge.run_once(objective.strip(), feedback=feedback,
                                 max_tasks=max_tasks, allow_git_commit=allow_git_commit)


async def canonical_cycle_loop():
    """Opt-in daemon loop using the canonical durable autonomy cycle."""
    bridge = None
    try:
        bridge = build_canonical_cycle_bridge()
        objective = os.getenv("AUTO_COMPANY_CANONICAL_OBJECTIVE",
                              "Inspect the enabled project and propose one verified improvement")
        cycle = 0
        feedback_scope = "autonomy:daemon-planner"
        feedback = ""
        checkpoints = getattr(getattr(bridge, "runtime", None), "checkpoints", None)
        if checkpoints is not None:
            feedback = checkpoints.latest_feedback(feedback_scope)
        while True:
            if PAUSE_FILE.exists():
                await asyncio.sleep(5)
                continue
            result = await run_canonical_daemon_once(
                bridge, objective, feedback=feedback,
                max_tasks=_env_number("AUTO_COMPANY_CANONICAL_MAX_TASKS", 1,
                                      minimum=1, maximum=100, integer=True),
                allow_git_commit=os.getenv("AUTO_COMPANY_CANONICAL_ALLOW_GIT_COMMIT", "").lower()
                in {"1", "true", "yes", "on"},
            )
            log(f"canonical cycle {cycle}: planned={result.planned} executed={result.executed} verified={result.verified} blocked={result.blocked}")
            feedback = result.feedback
            if checkpoints is not None:
                checkpoints.save_feedback(feedback_scope, feedback)
                if hasattr(checkpoints, 'save_progress'):
                    checkpoints.save_progress(
                        "daemon:canonical",
                        f"cycle={cycle} planned={result.planned} executed={result.executed} "
                        f"verified={result.verified} blocked={result.blocked}",
                    )
            cycle += 1
            limit = _env_number("AUTO_COMPANY_CANONICAL_MAX_CYCLES", 0,
                                minimum=0, maximum=10000, integer=True)
            if limit > 0 and cycle >= limit:
                return result
            await asyncio.sleep(_env_number("AUTO_COMPANY_CANONICAL_INTERVAL", 10.0,
                                            minimum=0.1, maximum=86400.0))
    finally:
        if bridge is not None:
            bridge.close()


async def execute_legacy_task_canonically(bridge, text, *, task_id, verification, artifact, priority=0):
    """Run a legacy string only through canonical verification/evidence gates."""
    if bridge is None:
        raise RuntimeError("canonical swarm bridge is not configured")
    return await bridge.execute_legacy_message(
        text, task_id=task_id, verification=verification,
        artifact=artifact, priority=priority,
    )

task_queue = asyncio.Queue()       
review_queue = asyncio.Queue()     
feedback_queue = asyncio.Queue()   

try:
    import httpx
    HAS_HTTPX = True
except ImportError:
    HAS_HTTPX = False

def check_internet():
    try:
        socket.create_connection(("api.groq.com", 443), timeout=2)
        return True and bool(GROQ_API_KEY)
    except OSError:
        return False

def log(msg: str):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    entry = f"[{timestamp}] [FLUTTER-SWARM] {msg}"
    print(entry, flush=True)
    with open(DAEMON_LOG, "a", encoding="utf-8") as f:
        f.write(entry + "\n")


# Backoff state per hardware target (track 429 cooldown separately per lane)
_backoff_until: dict[str, float] = {}
_backoff_seconds: dict[str, float] = {}
_MAX_BACKOFF = 3600.0  # 1h cap

async def call_persona(name: str, sys_prompt: str, user_prompt: str, hardware_target: str, max_tokens: int = 1500) -> str | None:
    """Call an LLM persona. Returns content string on success, None on failure."""
    import time
    online = check_internet()

    # --- Rate limit backoff check ---
    now = time.time()
    cooldown_until = _backoff_until.get(hardware_target, 0)
    if now < cooldown_until:
        remaining = int(cooldown_until - now)
        log(f"⏳ {name} -> {hardware_target} в cooldown ещё {remaining}s, пропуск раунда")
        return None

    # 🧠 HETEROGENEOUS COMPUTE ROUTING
    if hardware_target == "CLOUD_IF_ONLINE" and online:
        api_url = "https://api.groq.com/openai/v1/chat/completions"
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        model_id = CLOUD_HEAVY_MODEL
        timeout_val = _timeout_for(hardware_target, online)
        mode = "🌐 CLOUD"
    elif hardware_target == "LOCAL_CPU":
        api_url = "http://127.0.0.1:1234/v1/chat/completions"
        headers = {}
        model_id = LOCAL_HEAVY_MODEL
        timeout_val = _timeout_for(hardware_target, online)
        mode = "💻 LOCAL CPU"
    else:  # LOCAL_GPU
        api_url = "http://127.0.0.1:1234/v1/chat/completions"
        headers = {}
        model_id = LOCAL_FAST_MODEL
        timeout_val = _timeout_for(hardware_target, online)
        mode = "🚀 LOCAL GPU"

    log(f"🧠 {name} -> {mode} [{model_id}]")

    payload = {
        "model": model_id,
        "messages": [
            {"role": "system", "content": sys_prompt},
            {"role": "user", "content": user_prompt}
        ],
        "max_tokens": max_tokens,
        "temperature": 0.7
    }

    try:
        if HAS_HTTPX:
            async with httpx.AsyncClient(timeout=timeout_val) as client:
                r = await client.post(api_url, json=payload, headers=headers)
                if r.status_code == 200:
                    # Success — reset backoff for this lane
                    _backoff_until.pop(hardware_target, None)
                    _backoff_seconds.pop(hardware_target, None)
                    return r.json()["choices"][0]["message"].get("content", "").strip()
                elif r.status_code == 429:
                    # Rate limited — exponential backoff
                    prev = _backoff_seconds.get(hardware_target, 60.0)
                    next_backoff = min(prev * 2, _MAX_BACKOFF)
                    _backoff_seconds[hardware_target] = next_backoff
                    _backoff_until[hardware_target] = time.time() + next_backoff
                    log(f"🔴 {name} -> 429 rate limited, backoff {int(next_backoff)}s")
                    return None
                elif r.status_code in (400, 500, 503):
                    # Model unavailable or bad request — short backoff
                    _backoff_until[hardware_target] = time.time() + 30.0
                    log(f"⚠️ {name} -> HTTP {r.status_code}: модель недоступна, пауза 30s")
                    return None
                else:
                    log(f"⚠️ {name} -> HTTP {r.status_code}: неожиданный ответ")
                    return None
        else:
            log(f"⚠️ httpx недоступен, пропуск вызова {name}")
            return None
    except Exception as e:
        log(f"⚠️ {name} ошибка запроса: {e}")
        return None



async def ceo_loop():
    sys_lexa = (
        "Ты Леха (CEO). Проект: telegram-clicker-stars (лежит в projects/telegram-clicker-stars). "
        "Стек: Flutter, Riverpod, Hive (для оффлайн БД). "
        "НЕ ВЫДУМЫВАЙ React или Dexie! Проект уже существует. Не клонируй его с нуля. "
        "Твоя задача — улучшать визуальную часть (анимации клика, частиц монет в Flutter) и бесшовный оффлайн-режим через Hive. "
        "Пиши конкретные задачи для изменения файлов в папке lib/."
    )
    cycle = 1
    while True:
        try:
            if PAUSE_FILE.exists():
                await asyncio.sleep(5)
                continue

            feedback_context = ""
            while not feedback_queue.empty():
                feedback = await feedback_queue.get()
                feedback_context += f"ФИДБЕК ОТ QA: {feedback}\n"

            prompt = f"Раунд #{cycle}. Поставь 2 задачи для улучшения Flutter-кода (Анимации и Hive Оффлайн). {feedback_context}"
            lexa_speech = await call_persona("Леха (CEO)", sys_lexa, prompt, "CLOUD_IF_ONLINE")

            if lexa_speech is None:
                # Provider error / rate limit — wait before retry, don't write to consensus
                await asyncio.sleep(60)
                continue

            for _ in range(2):
                await task_queue.put(f"Задача раунда {cycle}:\n{lexa_speech}")

            with open(CONSENSUS_FILE, "a", encoding="utf-8") as f:
                f.write(f"\n## CEO Goal (Round {cycle})\n{lexa_speech}\n")

            cycle += 1
            await asyncio.sleep(10)
        except Exception as e:
            log(f"Ошибка CEO: {e}")
            await asyncio.sleep(30)

async def worker_loop(name: str, sys_prompt: str):
    while True:
        try:
            if PAUSE_FILE.exists():
                await asyncio.sleep(5)
                continue

            task = await task_queue.get()
            result = await call_persona(name, sys_prompt, f"Измени Flutter код по этой задаче:\n{task}", "LOCAL_GPU")

            if result is None:
                # Model unavailable — requeue the task for later
                await task_queue.put(task)
                task_queue.task_done()
                await asyncio.sleep(30)
                continue

            await review_queue.put(f"Автор: {name}\nКод:\n{result}")

            with open(CONSENSUS_FILE, "a", encoding="utf-8") as f:
                f.write(f"\n### {name} Code\n{result}\n")

            task_queue.task_done()
        except Exception as e:
            log(f"Ошибка рабочего {name}: {e}")
            await asyncio.sleep(30)

async def critic_loop():
    sys_enot = (
        "Ты Енот (Аудитор). Проверяй Flutter-код от разработчиков. "
        "Следи, чтобы анимации не просаживали 60 FPS, и чтобы Hive-боксы синхронизировались корректно. "
        "Если код повторяется или они переписывают проект с нуля — ругай их."
    )
    while True:
        try:
            if PAUSE_FILE.exists():
                await asyncio.sleep(5)
                continue

            result_to_review = await review_queue.get()
            audit = await call_persona("Енот (Critic)", sys_enot, f"Аудит Flutter-кода:\n{result_to_review}", "LOCAL_CPU")

            if audit is None:
                # Model unavailable — skip audit this round
                review_queue.task_done()
                await asyncio.sleep(30)
                continue

            if "ошибк" in audit.lower() or "заново" in audit.lower() or "повтор" in audit.lower():
                await feedback_queue.put(audit)

            with open(CONSENSUS_FILE, "a", encoding="utf-8") as f:
                f.write(f"\n### Critic Audit\n{audit}\n")

            review_queue.task_done()
        except Exception as e:
            log(f"Ошибка Критика: {e}")
            await asyncio.sleep(30)

async def main():
    log("🚀 СПЕЦОПЕРАЦИЯ: FLUTTER TELEGRAM CLICKER (MAX HARDWARE UTILIZATION)")

    if os.getenv("AUTO_COMPANY_CANONICAL_ENABLED", "").lower() in {"1", "true", "yes", "on"}:
        await canonical_cycle_loop()
        return
    
    ceo_task = asyncio.create_task(ceo_loop())
    ui_task = asyncio.create_task(worker_loop("Даня (UI/UX)", "Ты Даня (Flutter UI). Пиши виджеты, кастомные анимации (AnimationController, CustomPainter) для сочного кликера."))
    dev_task = asyncio.create_task(worker_loop("Вовчик (Logic)", "Ты Вовчик (Flutter Dev). Пиши стейт на Riverpod и оффлайн БД на Hive."))
    critic_task = asyncio.create_task(critic_loop())
    
    await asyncio.gather(ceo_task, ui_task, dev_task, critic_task)

if __name__ == "__main__":
    asyncio.run(main())
