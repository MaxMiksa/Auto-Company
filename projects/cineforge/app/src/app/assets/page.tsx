"use client";

import { useEffect, useState } from "react";
import { json, uploadFile } from "@/lib/api";
import { KIND_LABEL, SHOT_LABEL, type Asset, type AssetKind, type ShotKey } from "@/lib/types";

const empty = (): Asset => ({
  id: "",
  kind: "character",
  name: "",
  description: "",
  doNotTransfer: "",
  shots: { wide: "", medium: "", close: "" },
  createdAt: "",
});

export default function AssetsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [form, setForm] = useState<Asset>(empty());
  const [filter, setFilter] = useState<AssetKind | "all">("all");
  const [busy, setBusy] = useState(false);

  async function load() {
    setAssets(await json<Asset[]>("/api/assets"));
  }
  useEffect(() => {
    load();
  }, []);

  async function onShot(key: ShotKey, file?: File) {
    if (!file) return;
    const url = await uploadFile(file);
    setForm({ ...form, shots: { ...form.shots, [key]: url } });
  }

  async function save() {
    setBusy(true);
    await json("/api/assets", { method: "POST", body: JSON.stringify(form) });
    setForm(empty());
    await load();
    setBusy(false);
  }

  const shown = assets.filter((a) => filter === "all" || a.kind === filter);

  return (
    <div>
      <h1>素材库</h1>
      <p className="lead">人物、场景、物品各要 3 个机位图和一段不可变描述。成片时按这份身份契约引用，不让模型自由改脸改场。</p>

      <div className="row" style={{ marginBottom: 16 }}>
        {(["all", "character", "scene", "object"] as const).map((k) => (
          <button
            key={k}
            className={filter === k ? "btn primary" : "btn ghost"}
            type="button"
            onClick={() => setFilter(k)}
          >
            {k === "all" ? "全部" : KIND_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="grid-2">
        <section className="card stack">
          <h3>{form.id ? "编辑素材" : "新建素材"}</h3>
          <label className="field">
            类型
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as AssetKind })}
            >
              <option value="character">人物</option>
              <option value="scene">场景</option>
              <option value="object">物品</option>
            </select>
          </label>
          <label className="field">
            名称
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field">
            描述（身份锚点）
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
            />
          </label>
          <label className="field">
            禁止转移到成片的部分
            <input
              value={form.doNotTransfer}
              onChange={(e) => setForm({ ...form, doNotTransfer: e.target.value })}
            />
          </label>
          <div className="grid-3">
            {(Object.keys(SHOT_LABEL) as ShotKey[]).map((k) => (
              <label key={k} className="field">
                {SHOT_LABEL[k]}
                <div className="shot">
                  {form.shots[k] ? <img src={form.shots[k]} alt={k} /> : null}
                  <span>{k}</span>
                </div>
                <input type="file" accept="image/*" onChange={(e) => onShot(k, e.target.files?.[0])} />
              </label>
            ))}
          </div>
          <button className="btn primary" type="button" disabled={busy || !form.name} onClick={save}>
            保存素材
          </button>
        </section>

        <div className="stack">
          {shown.map((a) => (
            <article key={a.id} className="card">
              <div className="row">
                <h3>{a.name}</h3>
                <span className="badge">{KIND_LABEL[a.kind]}</span>
                <button className="btn ghost" type="button" onClick={() => setForm(a)}>
                  编辑
                </button>
              </div>
              <p style={{ color: "var(--mute)", fontSize: 14 }}>{a.description}</p>
              <div className="grid-3">
                {(Object.keys(SHOT_LABEL) as ShotKey[]).map((k) => (
                  <div className="shot" key={k}>
                    {a.shots[k] ? <img src={a.shots[k]} alt={k} /> : null}
                    <span>{SHOT_LABEL[k]}</span>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
