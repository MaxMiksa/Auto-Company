"use client";

import { useEffect, useState } from "react";
import { json, uploadFile } from "@/lib/api";
import type { VoiceProfile } from "@/lib/types";

export default function VoicesPage() {
  const [voices, setVoices] = useState<VoiceProfile[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [useFor, setUseFor] = useState<VoiceProfile["useFor"]>("dialogue");
  const [sampleUrl, setSampleUrl] = useState("");

  async function load() {
    setVoices(await json<VoiceProfile[]>("/api/voices"));
  }
  useEffect(() => {
    load();
  }, []);

  async function save() {
    await json("/api/voices", {
      method: "POST",
      body: JSON.stringify({ name, description, useFor, sampleUrl, cloneStatus: "ready" }),
    });
    setName("");
    setDescription("");
    setSampleUrl("");
    await load();
  }

  return (
    <div>
      <h1>声音克隆</h1>
      <p className="lead">上传样本生成可复用音色。创作台里每句台词必须选人物和这条音色，不能让模型自己决定谁在说话。</p>
      <div className="grid-2">
        <section className="card stack">
          <label className="field">
            音色名
            <input value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            声线描述
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} />
          </label>
          <label className="field">
            用途
            <select value={useFor} onChange={(e) => setUseFor(e.target.value as VoiceProfile["useFor"])}>
              <option value="dialogue">对白</option>
              <option value="narration">旁白</option>
              <option value="both">都能用</option>
            </select>
          </label>
          <label className="field">
            样本
            <input
              type="file"
              accept="audio/*"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) setSampleUrl(await uploadFile(f));
              }}
            />
            {sampleUrl && <span className="badge ok">已上传</span>}
          </label>
          <button className="btn primary" type="button" disabled={!name} onClick={save}>
            保存音色
          </button>
        </section>
        <div className="stack">
          {voices.map((v) => (
            <article key={v.id} className="card">
              <h3>{v.name}</h3>
              <p style={{ color: "var(--mute)" }}>{v.description}</p>
              <div className="row">
                <span className="badge">{v.useFor}</span>
                <span className="badge ok">{v.cloneStatus}</span>
              </div>
              {v.sampleUrl && <audio src={v.sampleUrl} controls style={{ width: "100%", marginTop: 10 }} />}
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
