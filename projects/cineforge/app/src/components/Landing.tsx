"use client";

import Link from "next/link";
import { useEffect, useState, type FormEvent } from "react";
import "./landing.css";

type SubmitState = "idle" | "sending" | "ok" | "err";
/** live=成片可写 · compile=编译轨就绪 · waitlist=双轨皆未就绪 */
type ChannelMode = "waitlist" | "compile" | "live";

type HealthPayload = {
  writable?: unknown;
  compileReady?: unknown;
};

function isWritableTrue(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  return (data as HealthPayload).writable === true;
}

function isCompileReady(data: unknown): boolean {
  if (!data || typeof data !== "object") return false;
  return (data as HealthPayload).compileReady === true;
}

export function Landing() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [intent, setIntent] = useState("");
  const [status, setStatus] = useState<SubmitState>("idle");
  const [message, setMessage] = useState("");
  const [channel, setChannel] = useState<ChannelMode>("waitlist");

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function poll() {
      try {
        const res = await fetch("/api/health", {
          cache: "no-store",
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) {
          if (!cancelled) setChannel("waitlist");
        } else {
          const data: unknown = await res.json().catch(() => null);
          if (!cancelled) {
            if (isWritableTrue(data)) {
              setChannel("live");
            } else if (isCompileReady(data)) {
              setChannel("compile");
            } else {
              setChannel("waitlist");
            }
          }
        }
      } catch {
        if (!cancelled) setChannel("waitlist");
      } finally {
        if (!cancelled) {
          timer = setTimeout(poll, 12_000);
        }
      }
    }

    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, intent }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setStatus("err");
        setMessage(data.error || "提交失败，请稍后重试。");
        return;
      }
      setStatus("ok");
      setMessage("已记下。通道恢复后我们会联系你做真人验收。");
      setName("");
      setEmail("");
      setIntent("");
    } catch {
      setStatus("err");
      setMessage("网络异常，请稍后重试。");
    }
  }

  const live = channel === "live";
  const compile = channel === "compile";

  return (
    <div
      className={`landing${live ? " landing-live" : ""}${compile ? " landing-compile" : ""}`}
    >
      <div className="landing-atmosphere" aria-hidden="true">
        <div className="landing-gate" />
        <div className="landing-bokeh landing-bokeh-a" />
        <div className="landing-bokeh landing-bokeh-b" />
        <div className="landing-bokeh landing-bokeh-c" />
        <div className="landing-bokeh landing-bokeh-d" />
        <div className="landing-bokeh landing-bokeh-e" />
        <div className="landing-grain" />
        <div className="landing-vignette" />
      </div>

      <header className="landing-hero">
        <div className="landing-hero-inner">
          <p className="landing-brand reveal reveal-1">
            镜场
            <span className="landing-brand-en">CineForge</span>
            {compile ? (
              <span className="landing-channel-badge compile">编译就绪</span>
            ) : live ? (
              <span className="landing-channel-badge live">通道可写</span>
            ) : null}
          </p>
          <h1 className="landing-headline reveal reveal-2">
            锁住场、戏、空间、人、声——再谈成片。
          </h1>
          <p className="landing-sub reveal reveal-3">
            给非专业创作者的专业短视频生成：一致性是硬锁，不是一堆风格滤镜。
          </p>
          <div className="landing-cta reveal reveal-4">
            {live ? (
              <>
                <Link href="/studio" className="landing-btn landing-btn-primary">
                  开始生成
                </Link>
                <a href="#waitlist" className="landing-btn landing-btn-secondary">
                  仍要预约
                </a>
              </>
            ) : compile ? (
              <>
                <Link href="/studio" className="landing-btn landing-btn-primary">
                  试编译导演包
                </Link>
                <a href="#waitlist" className="landing-btn landing-btn-secondary">
                  预约成片验收
                </a>
              </>
            ) : (
              <>
                <Link href="/studio" className="landing-btn landing-btn-primary">
                  进入创作台
                </Link>
                <a href="#waitlist" className="landing-btn landing-btn-secondary">
                  预约验收
                </a>
              </>
            )}
          </div>
          <p
            className={`landing-status reveal reveal-5${live ? " landing-status-live" : ""}${compile ? " landing-status-compile" : ""}`}
            role="status"
            aria-live="polite"
          >
            {live ? (
              <>
                <span className="landing-status-full">
                  成片通道已接通（探活可写）。主入口可提交真任务；稳定交片仍以真人验收为准，勿把首跑当量产 SLA。
                </span>
                <span className="landing-status-short">
                  通道可写 · 可进创作台生成
                </span>
              </>
            ) : compile ? (
              <>
                <span className="landing-status-full">
                  编译通道已就绪：可先锁场戏空间、绑人绑声、导出导演包。成片仍待 Omni
                  或 Seedance 密钥——稳定交片请预约验收。
                </span>
                <span className="landing-status-short">
                  编译可用 · 成片待恢复
                </span>
              </>
            ) : (
              <>
                <span className="landing-status-full">
                  通道恢复中：编译与成片皆未就绪。留下意向，接通后我们按名单做真人验收。
                </span>
                <span className="landing-status-short">
                  双轨恢复中 · 请预约验收
                </span>
              </>
            )}
          </p>
        </div>
      </header>

      <section className="landing-section">
        <h2>一致性，硬锁。</h2>
        <p>
          你先钉死这场戏发生在哪、谁在场、谁说话、站在哪——生成时这些字段跟过去，不被风格词冲掉。
        </p>
      </section>

      <section className="landing-section">
        <h2>白话进，专业锁出。</h2>
        <p>
          你用日常语言说意图；镜场编译成可继承的场、戏、空间与人物声线绑定，你不必写导演级长提示词。
        </p>
      </section>

      <section className="landing-section">
        <h2>别人比滤镜，我们比能不能认人。</h2>
        <p>
          跨镜还是同一个人、同一间屋子、同一条声线——这才是你会转发给同事看的差别。
        </p>
      </section>

      <section className="landing-section landing-waitlist" id="waitlist">
        <h2>{live ? "预约真人验收" : "预约验收"}</h2>
        <p>
          {live
            ? "通道已可写，但探活不等于量产。留下意向，我们按名单做真人验收与首成片确认。"
            : "通道尚未恢复。留下意向，引擎接通后我们按名单做真人验收——不假装现在就能交片。"}
        </p>
        <form className="landing-form" onSubmit={onSubmit}>
          <label>
            姓名
            <input
              name="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              required
              maxLength={80}
            />
          </label>
          <label>
            邮箱
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
              maxLength={160}
            />
          </label>
          <label>
            意向
            <textarea
              name="intent"
              value={intent}
              onChange={(e) => setIntent(e.target.value)}
              placeholder="想验什么：片种、时长、人物一致性……"
              required
              maxLength={800}
              rows={4}
            />
          </label>
          <button
            type="submit"
            className="landing-btn landing-btn-primary"
            disabled={status === "sending"}
          >
            {status === "sending" ? "提交中…" : "提交预约"}
          </button>
          {message ? (
            <p
              className={
                status === "ok" ? "landing-form-msg ok" : "landing-form-msg err"
              }
              role="status"
            >
              {message}
            </p>
          ) : null}
        </form>
      </section>

      <footer className="landing-footer">
        <p>
          {live
            ? "镜场 CineForge · 探活可写已打开生成入口。首成片请跑验收脚本或在创作台提交真任务；勿将单次成功当成量产 SLA。"
            : compile
              ? "镜场 CineForge · 编译轨已开：创作台可锁场导出导演包；成片入口待通道恢复，请以预约验收为准。"
              : "镜场 CineForge · 我们只在通道真正可用时说「能出片」。当前请以预约验收为准，勿将预览或占位当成量产结果。"}
        </p>
      </footer>
    </div>
  );
}
