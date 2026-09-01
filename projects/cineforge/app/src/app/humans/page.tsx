"use client";

import { useEffect, useState } from "react";
import { json } from "@/lib/api";
import type { Asset, LikenessClone, VoiceProfile } from "@/lib/types";

export default function HumansPage() {
  const [humans, setHumans] = useState<LikenessClone[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [name, setName] = useState("");
  const [consent, setConsent] = useState("");
  const [characterId, setCharacterId] = useState("");
  const [defaultVoiceId, setDefaultVoiceId] = useState("");
  const [notes, setNotes] = useState("");

  async function load() {
    const [h, a, v] = await Promise.all([
      json<LikenessClone[]>("/api/humans"),
      json<Asset[]>("/api/assets"),
      json<VoiceProfile[]>("/api/voices"),
    ]);
    setHumans(h);
    setAssets(a.filter((x) => x.kind === "character"));
    setVoices(v);
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    await json("/api/humans", {
      method: "POST",
      body: JSON.stringify({
        name,
        consent,
        characterId,
        defaultVoiceId,
        notes,
        cloneStatus: consent.trim() ? "ready" : "failed",
      }),
    });
    setName("");
    setConsent("");
    setNotes("");
    await load();
  }

  return (
    <div>
      <h1>人生克隆</h1>
      <p className="lead">
        只克隆已书面授权的本人或权利人形象。绑定人物三镜头和默认音色。未授权明星、网图真人一律不做。
      </p>
      <div className="grid-2">
        <section className="card stack">
          <label className="field">
            名称
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            授权声明（必填）
            <textarea
              value={consent}
              onChange={(e) => setConsent(e.target.value)}
              placeholder="我确认已获得该形象的克隆授权……"
            />
          </label>
          <label className="field">
            绑定人物素材
            <select value={characterId} onChange={(e) => setCharacterId(e.target.value)}>
              <option value="">选择人物</option>
              {assets.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            默认音色
            <select value={defaultVoiceId} onChange={(e) => setDefaultVoiceId(e.target.value)}>
              <option value="">选择音色</option>
              {voices.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            备注
            <input value={notes} onChange={(e) => setNotes(e.target.value)} />
          </label>
          <button className="btn primary" type="button" disabled={!name || !consent} onClick={save}>
            建立克隆档案
          </button>
        </section>
        <div className="stack">
          {humans.map((h) => {
            const c = assets.find((a) => a.id === h.characterId);
            const v = voices.find((x) => x.id === h.defaultVoiceId);
            return (
              <article key={h.id} className="card">
                <h3>{h.name}</h3>
                <p style={{ color: "var(--mute)" }}>{h.consent}</p>
                <div className="row">
                  <span className="badge">人物 {c?.name || "未绑"}</span>
                  <span className="badge">音色 {v?.name || "未绑"}</span>
                  <span className={h.cloneStatus === "ready" ? "badge ok" : "badge warn"}>{h.cloneStatus}</span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </div>
  );
}
