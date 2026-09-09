"""Mock provider for testing without API keys."""
import asyncio
import time
from dataclasses import dataclass
from typing import Optional
from core.providers import BaseProvider, LLMResponse


@dataclass
class RateLimitInfo:
    """Structured rate limit information."""
    remaining: int
    reset_at: float
    in_backoff: bool = False
    backoff_until: float = 0.0


class MockProvider(BaseProvider):
    """Mock provider that returns pre-configured responses."""

    def __init__(self, config=None, latency_ms: int = 0, healthy: bool = True):
        self._response = "Mock response: The answer is 42."
        self._error = None
        self._error_code = None
        self._rate_limit_info: Optional[RateLimitInfo] = None
        self._latency_ms = latency_ms
        self._healthy = healthy
        self._error_sequence = None
        self._error_idx = 0
        self.config = config
        # provider name for failover chain identification
        self.name = "mock"

    def is_available(self) -> bool:
        return True

    def is_rate_limited(self) -> bool:
        if self._rate_limit_info and self._rate_limit_info.in_backoff:
            return time.time() < self._rate_limit_info.backoff_until
        return False

    def health_score(self) -> float:
        return 1.0 if self._healthy else 0.0

    def set_response(self, response: str):
        self._response = response

    def set_error(self, code: int, message: str):
        self._error = message
        self._error_code = code

    def set_error_sequence(self, errors: list):
        """Accept list of codes OR list of (code, msg) tuples."""
        processed = []
        for e in errors:
            if isinstance(e, tuple):
                processed.append(e)
            else:
                # plain status code, 200 means success
                processed.append((e, "OK" if e == 200 else f"Error {e}"))
        self._error_sequence = processed
        self._error_idx = 0

    def set_rate_limit_info(self, remaining: int, reset_at: float):
        self._rate_limit_info = RateLimitInfo(
            remaining=remaining,
            reset_at=reset_at,
            in_backoff=True,
            backoff_until=reset_at,
        )

    @property
    def last_rate_limit_info(self) -> RateLimitInfo:
        if self._rate_limit_info is not None:
            return self._rate_limit_info
        return RateLimitInfo(remaining=1000, reset_at=0)

    async def generate(self, prompt, system_prompt: str = "", max_retries: int = 3) -> LLMResponse:
        """Generate mock response with retry support."""
        if self._latency_ms > 0:
            await asyncio.sleep(self._latency_ms / 1000.0)

        # Handle error sequence with retry logic
        if self._error_sequence:
            retries_left = max_retries
            while retries_left >= 0 and self._error_idx < len(self._error_sequence):
                code, msg = self._error_sequence[self._error_idx]
                self._error_idx += 1
                if code == 200:
                    # success — fall through to normal response
                    break
                if code == 429:
                    from core.providers import RateLimitException
                    raise RateLimitException("Rate limited (429)")
                if 500 <= code < 600 and retries_left > 0:
                    # transient — retry
                    retries_left -= 1
                    await asyncio.sleep(0.01)
                    continue
                # non-retryable or out of retries
                return LLMResponse(
                    content="",
                    provider_name="mock",
                    model="mock-gpt",
                    success=False,
                    error=msg,
                )
            # If we consumed sequence and last was 200, return success below

        if self._error:
            await asyncio.sleep(0.01)
            if self._error_code == 429:
                from core.providers import RateLimitException
                raise RateLimitException("Rate limited (429)")
            # Non-429 errors return failed LLMResponse instead of raising
            return LLMResponse(
                content="",
                provider_name="mock",
                model="mock-gpt",
                success=False,
                error=self._error,
                error_code=self._error_code,
            )

        from core.providers import LLMResponse as _LLMResponse
        return _LLMResponse(
            content=self._response,
            provider_name="mock",
            model="mock-gpt",
            input_tokens=10,
            output_tokens=20,
            total_tokens=30,
            cost_cents=0.0,
            latency_ms=self._latency_ms,
        )

    def _create_exception(self, code, msg):
        from core.providers import RateLimitException
        if code == 429:
            return RateLimitException("Rate limited (429)")
        return Exception(f"{msg} (code: {code})")


