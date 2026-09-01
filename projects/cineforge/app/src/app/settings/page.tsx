"use client";

import { useEffect, useState } from "react";
import { json } from "@/lib/api";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/types";

export default function SettingsPage() {
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<Record<string, unknown> | null>(null);
  const [saved, setSaved] = useState("");

  useEffect(() => {
    json<Settings>("/api/settings").then(setS);
    json<Record<string, unknown>>("/api/health").then(setHealth);
  }, []);

  async function save() {
    const next = await json<Settings>("/api/settings", { method: "PUT", body: JSON.stringify(s) });
    setS(next);
    setHealth(await json("/api/health"));
    setSaved("已保存到本机");
  }

  const seedance = health?.seedance as { ready?: boolean; detail?: string; model?: string } | undefined;
  const compileReady = health?.compileReady === true;
  const writable = health?.writable === true;
  const llm = health?.llm as { ok?: boolean; detail?: string } | undefined;

  return (
    <div>
      <h1>设置</h1>
      <p className="lead">
        成片模型与提示词编译器分开选。密钥只存在本机 `.data` 或环境变量（`SEEDANCE_API_KEY` /
        `ARK_API_KEY`），不要提交仓库。
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <span className={writable ? "badge ok" : "badge warn"}>
          {writable ? "可写" : "不可写"}
        </span>
        <span className={compileReady ? "badge ok" : "badge warn"}>
          编译 {compileReady ? "就绪" : "不可用"}
        </span>
        <span className={seedance?.ready ? "badge ok" : "badge warn"}>
          Seedance {seedance?.ready ? "就绪" : "未就绪"}
        </span>
        {seedance?.model && <span className="badge lock">{seedance.model}</span>}
        {llm?.detail && <span className="badge lock">{llm.detail}</span>}
      </div>
      <section className="card stack" style={{ maxWidth: 720, marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>Key 注入（人类一步）</h3>
        <p className="lead" style={{ margin: 0 }}>
          应用在跑时，终端执行（Key 不会进 git）：
        </p>
        <pre className="prompt-box">{`# 方式 A：脚本写入本机 settings
SEEDANCE_API_KEY=你的Key ./projects/cineforge/scripts/inject-seedance-key.sh

# 方式 B：启动进程时注入 env
SEEDANCE_API_KEY=你的Key npm start --prefix projects/cineforge/app

# 可选模型（2.0 开通时）
SEEDANCE_MODEL=doubao-seedance-2-0-260128`}</pre>
        <p className="lead" style={{ margin: 0 }}>
          注入后跑成片验收：<code>./projects/cineforge/scripts/accept-first-render.sh</code>
          · 编译验收（无需 Key）：<code>accept-compile-pipeline.sh</code> / <code>accept-compile-export.sh</code>
        </p>
      </section>
      <section className="card stack" style={{ maxWidth: 720 }}>
        <label className="field">
          成片模型
          <select
            value={s.videoProvider}
            onChange={(e) => setS({ ...s, videoProvider: e.target.value as Settings["videoProvider"] })}
          >
            <option value="minimax-h3">本地 MiniMax-H3（默认；降级时可自动 failover）</option>
            <option value="seedance-2.0">Seedance / Ark（显式备用）</option>
          </select>
        </label>
        <label className="field">
          MiniMax 基址
          <input value={s.minimaxBase} onChange={(e) => setS({ ...s, minimaxBase: e.target.value })} />
        </label>
        <label className="field">
          Seedance API
          <input value={s.seedanceBase} onChange={(e) => setS({ ...s, seedanceBase: e.target.value })} />
        </label>
        <label className="field">
          Seedance 模型名
          <input
            value={s.seedanceModel}
            onChange={(e) => setS({ ...s, seedanceModel: e.target.value })}
            placeholder="doubao-seedance-1-0-pro-250528 或 doubao-seedance-2-0-260128"
          />
        </label>
        <label className="field">
          Seedance Key（可被 env 覆盖）
          <input
            type="password"
            value={s.seedanceKey}
            onChange={(e) => setS({ ...s, seedanceKey: e.target.value })}
            placeholder="留空则读 SEEDANCE_API_KEY / ARK_API_KEY"
          />
        </label>
        <p className="lead" style={{ margin: 0 }}>
          无 Key 时备用通道不可用：提交会本地 failed，不会 mock。有 2.0 开通时用 env{" "}
          <code>SEEDANCE_MODEL=doubao-seedance-2-0-260128</code>。
        </p>
        <label className="field">
          提示词 LLM
          <select
            value={s.llmProvider}
            onChange={(e) => setS({ ...s, llmProvider: e.target.value as Settings["llmProvider"] })}
          >
            <option value="local">本地规则编译（不联网）</option>
            <option value="vllm">vLLM / OpenAI 兼容</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
        <label className="field">
          vLLM 基址
          <input value={s.vllmBase} onChange={(e) => setS({ ...s, vllmBase: e.target.value })} />
        </label>
        <label className="field">
          vLLM 模型
          <input value={s.vllmModel} onChange={(e) => setS({ ...s, vllmModel: e.target.value })} />
        </label>
        <label className="field">
          OpenAI 基址
          <input value={s.openaiBase} onChange={(e) => setS({ ...s, openaiBase: e.target.value })} />
        </label>
        <label className="field">
          OpenAI 模型
          <input value={s.openaiModel} onChange={(e) => setS({ ...s, openaiModel: e.target.value })} />
        </label>
        <label className="field">
          OpenAI Key
          <input type="password" value={s.openaiKey} onChange={(e) => setS({ ...s, openaiKey: e.target.value })} />
        </label>
        <button className="btn primary" type="button" onClick={save}>
          保存
        </button>
        {saved && <span className="badge ok">{saved}</span>}
        {health && (
          <pre className="prompt-box">{JSON.stringify(health, null, 2)}</pre>
        )}
      </section>
    </div>
  );
}
