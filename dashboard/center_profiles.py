"""Named execution defaults; never evaluates shell config or stores credentials."""
import os
from pathlib import Path
import shlex

from center_store import CenterError

ENGINES = {"claude", "codex", "cursor", "openai-compatible"}
EFFORTS = {"none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"}
FIELDS = ("engine", "model", "effort", "productLanguage")


def validate(config):
    if not isinstance(config, dict) or set(config) != set(FIELDS):
        raise CenterError("INVALID_CONFIG", "Unsupported execution configuration")
    if (any(not isinstance(config.get(key), str) for key in FIELDS)
            or config.get("engine") not in ENGINES or config.get("effort") not in EFFORTS
            or config.get("productLanguage") not in {"en", "zh-CN"}):
        raise CenterError("INVALID_CONFIG", "Invalid engine, effort or product language")
    model = config.get("model")
    if not isinstance(model, str) or len(model) > 200 or any(ord(char) < 32 for char in model):
        raise CenterError("INVALID_CONFIG", "Invalid model name")
    return dict(config)


def installation_defaults(root, language):
    names = {"ENGINE": "engine", "MODEL": "model", "CODEX_REASONING_EFFORT": "effort",
             "AUTO_COMPANY_LANGUAGE": "productLanguage"}
    selected = {name: os.environ[name] for name in names if name in os.environ}
    # These files contain the choices saved by the existing launch/install flow.
    # Read only known values as data, never source a shell file or expose secrets.
    for name in (".auto-loop.env", ".auto-company.local"):
        path = Path(root) / name
        if not path.is_file() or path.is_symlink() or path.stat().st_size > 65536:
            continue
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            key, separator, value = line.removeprefix("export ").partition("=")
            if separator and key.strip() in names:
                try:
                    words = shlex.split(value, comments=True)
                except ValueError:
                    continue
                if len(words) <= 1:
                    selected[key.strip()] = words[0] if words else ""
    config = dict(engine="codex", model="", effort="high", productLanguage=language)
    for name, key in names.items():
        if name in selected:
            candidate = {**config, key: selected[name]}
            try:
                config = validate(candidate)
            except CenterError:
                pass
    return config


def defaults(tx, preferences):
    template = tx.get("templates", preferences.get("defaultTemplateId")) if preferences.get("defaultTemplateId") else None
    if template:
        return validate(template["config"]), "template"
    if preferences.get("lastConfig"):
        return validate(preferences["lastConfig"]), "last"
    return validate(preferences.get("installationConfig") or {key: preferences[key] for key in FIELDS}), "installation"


def remember(tx, config):
    preferences = tx.get("preferences", "main")
    value = {key: config[key] for key in FIELDS}
    if preferences.get("lastConfig") != value:
        preferences.update(lastConfig=value, revision=preferences["revision"] + 1)
        tx.put("preferences", "main", preferences)
