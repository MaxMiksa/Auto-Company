import asyncio

from core.offline_provider import OfflineProvider


def test_llama_backend_keeps_callable_separate_from_name():
    provider = OfflineProvider(use_templates=True)
    provider._backend_name = "llama_cpp"
    provider._backend = lambda *args, **kwargs: {
        "choices": [{"text": "generated locally"}]
    }

    result = asyncio.run(provider.generate("execute this task"))

    assert result.text == "generated locally"
    assert result.model == "llama_cpp"
    assert provider._backend_name == "llama_cpp"


def test_transformers_placeholder_does_not_claim_loaded_backend():
    provider = OfflineProvider(use_templates=True)
    assert provider._load_transformers() is None
    assert provider._backend_name is None

def test_generate_does_not_reload_loaded_backend(monkeypatch, tmp_path):
    provider = OfflineProvider(model_path=str(tmp_path / "model.gguf"))
    provider._backend_name = "fake"
    calls = {"load": 0}
    provider._backend = lambda prompt, **kwargs: {"choices": [{"text": "ok"}]}

    def fail_reload():
        calls["load"] += 1
        raise AssertionError("loaded backend was reinitialized")

    monkeypatch.setattr(provider, "_load_llamacpp", fail_reload)
    import asyncio
    asyncio.run(provider.generate("execute task"))
    assert calls["load"] == 0
    # Backend should still be set (generate used it, not cleared it)


def test_close_releases_backend_even_when_backend_cleanup_fails():
    provider = OfflineProvider(use_templates=True)
    calls = []

    class Backend:
        def close(self):
            calls.append("close")
            raise RuntimeError("backend cleanup failure")

    provider._backend_name = "llama_cpp"
    provider._backend = Backend()
    provider.close()
    assert calls == ["close"]
    assert provider._backend is None
    assert provider._backend_name is None


def test_provider_context_manager_releases_backend():
    provider = OfflineProvider(use_templates=True)
    provider._backend_name = "fake"
    provider._backend = object()
    with provider:
        assert provider._backend is not None
    assert provider._backend is None
