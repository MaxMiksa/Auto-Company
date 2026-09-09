"""Rate limit guard for provider monitoring."""
import time
from collections import defaultdict
from enum import Enum


class RateLimitAction(Enum):
    ALLOW = "allow"
    THROTTLE = "throttle"
    BLOCK = "block"
    EMERGENCY_STOP = "emergency_stop"


class RateLimitGuard:
    """Monitor and enforce provider rate limits."""

    EMERGENCY_429_THRESHOLD = 5
    BACKOFF_BASE = 60
    BACKOFF_MAX = 600

    def __init__(self, provider_config: dict | None = None):
        self.provider_states: dict = defaultdict(lambda: {
            'requests_per_minute': 0,
            'requests_per_day': 0,
            'daily_limit': 1500,
            'is_rate_limited': False,
            'consecutive_429s': 0,
            'last_429_timestamp': 0,
            'backoff_until': 0,
            'health_score': 1.0,
            'avg_latency_ms': 100.0,
            'error_rate': 0.0
        })
        self.events: list = []
        # Accept provider config dict: {provider_name: {rpd_limit: N, ...}}
        if provider_config:
            for provider, cfg in provider_config.items():
                state = self.provider_states[provider]
                if 'rpd_limit' in cfg:
                    state['daily_limit'] = cfg['rpd_limit']

    def should_use_provider(self, provider: str, daily_limit: int = 1500) -> bool:
        state = self.provider_states[provider]
        state['daily_limit'] = daily_limit

        now = time.time()
        if state['is_rate_limited'] and now < state['backoff_until']:
            return False
        return True

    def check_before_request(self, provider: str) -> RateLimitAction:
        state = self.provider_states[provider]
        now = time.time()

        if state['is_rate_limited'] and now < state['backoff_until']:
            if state['consecutive_429s'] >= self.EMERGENCY_429_THRESHOLD:
                return RateLimitAction.EMERGENCY_STOP
            return RateLimitAction.BLOCK

        if state['requests_per_minute'] > state['daily_limit'] * 0.8:
            return RateLimitAction.THROTTLE

        return RateLimitAction.ALLOW

    def record_429(self, provider: str):
        state = self.provider_states[provider]
        state['is_rate_limited'] = True
        state['consecutive_429s'] += 1
        state['last_429_timestamp'] = time.time()
        backoff = min(self.BACKOFF_BASE * (2 ** state['consecutive_429s']), self.BACKOFF_MAX)
        state['backoff_until'] = time.time() + backoff

        if state['consecutive_429s'] >= self.EMERGENCY_429_THRESHOLD:
            state['health_score'] = max(0.1, state['health_score'] - 0.2)

        self.events.append({
            'provider': provider,
            'timestamp': time.time(),
            'action': '429',
            'consecutive_429s': state['consecutive_429s'],
            'backoff_until': state['backoff_until']
        })

    def record_success(self, provider: str, tokens_used: int = 0, latency_ms: float = 0):
        state = self.provider_states[provider]
        state['requests_per_minute'] += 1
        state['requests_per_day'] += 1
        state['consecutive_429s'] = 0
        state['is_rate_limited'] = False

        if latency_ms > 0:
            state['avg_latency_ms'] = (state['avg_latency_ms'] * 0.9) + (latency_ms * 0.1)

        if state['requests_per_minute'] > 0 and state['error_rate'] < 0.05:
            state['health_score'] = min(1.0, state['health_score'] + 0.01)

    def get_provider_order(self) -> list:
        """Return providers sorted by health score (best first)."""
        return sorted(self.provider_states.keys(), key=lambda p: self.provider_states[p]['health_score'], reverse=True)

    def get_healthy_providers(self) -> list:
        """Return providers not currently rate-limited."""
        now = time.time()
        return [name for name, state in self.provider_states.items() if not (state['is_rate_limited'] and now < state['backoff_until'])]

    def get_rate_limit_status(self) -> dict:
        """Get current rate limit status for all providers."""
        now = time.time()
        return {
            name: {
                'in_backoff': state['is_rate_limited'],
                'backoff_remaining_s': max(0, state['backoff_until'] - now) if state['is_rate_limited'] else 0,
                'consecutive_429s': state['consecutive_429s'],
                'requests_today': state['requests_per_day'],
                'daily_limit': state['daily_limit'],
                'pct_used': min(100, state['requests_per_day'] / state['daily_limit'] * 100) if state['daily_limit'] > 0 else 0,
                'health_score': state['health_score'],
                'avg_latency_ms': state['avg_latency_ms']
            }
            for name, state in self.provider_states.items()
        }

    def reset_minute_counters(self):
        """Reset per-minute counters (call every minute)."""
        for state in self.provider_states.values():
            state['requests_per_minute'] = 0

    def get_emergency_state(self) -> bool:
        """Return True if any provider has hit the emergency 429 threshold."""
        return any(
            state['consecutive_429s'] >= self.EMERGENCY_429_THRESHOLD
            for state in self.provider_states.values()
        )
