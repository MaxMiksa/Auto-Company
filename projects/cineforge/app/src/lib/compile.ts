import type { Asset, CompiledPrompt, ProjectDraft, VoiceProfile } from "./types";

export function buildLockBrief(
  draft: ProjectDraft,
  assets: Asset[],
  voices: VoiceProfile[],
): string {
  const sceneAsset = assets.find((a) => a.id === draft.scene.sceneId);
  const objects = assets.filter((a) => draft.objectIds.includes(a.id));
  const chars = assets.filter((a) =>
    draft.blocking.some((b) => b.characterId === a.id),
  );

  const lines = [
    "你是现场导演，把用户意图编译成一条可直接给视频模型的成片提示词。",
    "必须保留全部锁定信息，禁止用风格词替换站位、视线、场景几何或声线归属。",
    "对用户用白话；对模型用具体可见动作、光、空间关系。不要空洞的「电影感」「杰作」。",
    "",
    "【用户意图】",
    draft.intent.trim() || "（空）",
    "",
    "【任务锁 TASK】",
    `目标：${draft.task.goal}`,
    `成功标准：${draft.task.success}`,
    `禁止：${draft.task.forbidden}`,
    `时长 ${draft.task.durationSec}s，画幅 ${draft.task.aspectRatio}，模式 ${draft.mode}`,
    "",
    "【场景锁 SCENE】",
    `场：${draft.scene.name || sceneAsset?.name || "未选"}`,
    sceneAsset ? `场景三镜头身份：${sceneAsset.description}` : "",
    `空间：${draft.scene.space}`,
    `时间：${draft.scene.timeOfDay}　天气：${draft.scene.weather}`,
    `光：${draft.scene.light}`,
    `道具：${draft.scene.props}`,
    `不可变：${draft.scene.immutable}`,
    sceneAsset?.doNotTransfer ? `场景禁止转移：${sceneAsset.doNotTransfer}` : "",
    "",
    "【人物与三镜头】",
    ...chars.map((c) => `- ${c.name}：${c.description}｜禁止：${c.doNotTransfer}`),
    "",
    "【空间定位 BLOCKING】",
    ...draft.blocking.map((b) => {
      const c = assets.find((a) => a.id === b.characterId);
      return `- ${c?.name ?? b.characterId}：站位 ${b.stance}；朝向 ${b.bodyFacing}；视线 ${b.eyeline}；进出 ${b.inOut}；景深 ${b.depth}；机位 ${b.camera}；镜头 ${b.lensFeel}`;
    }),
    "",
    "【物品】",
    ...objects.map((o) => `- ${o.name}：${o.description}｜禁止：${o.doNotTransfer}`),
    "",
    "【台词与音色】",
    ...draft.lines.map((l) => {
      const c = assets.find((a) => a.id === l.characterId);
      const v = voices.find((x) => x.id === l.voiceId);
      return `- ${l.atSec}s ${c?.name ?? "?"} 用音色「${v?.name ?? "未选"}」以「${l.emotion}」说：「${l.text}」${v ? `（${v.description}）` : ""}`;
    }),
    "",
    "输出要求：只输出最终成片提示词正文，不要前言。必须按顺序写入：一场空间与光、任务节拍、每人站位朝向视线、引用人物/场景/物品身份、对白归属与口型、一个主镜头运动、环境声。最后用否定句钉死不可变项。",
  ];
  return lines.filter(Boolean).join("\n");
}

export function compileLocal(
  draft: ProjectDraft,
  assets: Asset[],
  voices: VoiceProfile[],
): string {
  const scene = assets.find((a) => a.id === draft.scene.sceneId);
  const chars = draft.blocking.map((b) => {
    const c = assets.find((a) => a.id === b.characterId);
    return { b, c };
  });
  const objects = assets.filter((a) => draft.objectIds.includes(a.id));
  const firstCam = draft.blocking[0]?.camera || "胸部高度中景，缓慢推近";
  const firstLens = draft.blocking[0]?.lensFeel || "35mm，贴近柜台进深";

  const people = chars
    .map(({ b, c }) => {
      const name = c?.name ?? "角色";
      return `${name}保持三镜头身份（${c?.description ?? "未见描述"}），站在${b.stance || "场内锚点"}，身体朝向${b.bodyFacing || "对手"}，视线落在${b.eyeline || "对方眼睛"}，${b.inOut || "已在画内"}，处于${b.depth}景。`;
    })
    .join(" ");

  const dialogue = draft.lines
    .map((l) => {
      const c = assets.find((a) => a.id === l.characterId);
      const v = voices.find((x) => x.id === l.voiceId);
      return `${l.atSec}秒由${c?.name ?? "角色"}用「${v?.name ?? "未指定音色"}」以${l.emotion || "克制"}口型清楚说出：「${l.text}」。声线只属于此人，不串到别人。`;
    })
    .join(" ");

  const props = objects
    .map((o) => `${o.name}必须是：${o.description}`)
    .join("；");

  const intent = draft.intent.trim() || draft.task.goal;

  return [
    `${draft.scene.timeOfDay}，${draft.scene.weather}。${scene?.name || draft.scene.name || "场景"}：${draft.scene.space || scene?.description || ""}。主光：${draft.scene.light}。场内道具：${draft.scene.props}。`,
    `本镜只完成这件事：${draft.task.goal || intent}。观众必须看见：${draft.task.success || intent}。`,
    people,
    props ? `物品锁定：${props}。` : "",
    `机位：${firstCam}。镜头感：${firstLens}。一个有动机的运动，不要乱切。`,
    dialogue || "本镜无对白，只保留环境声与表演。",
    `环境声贴合这场：雨打玻璃、风铃、冷柜低频，不要无来源配乐压过人声。`,
    `不可变：${draft.scene.immutable}。禁止：${draft.task.forbidden}。${scene?.doNotTransfer ?? ""} ${chars.map(({ c }) => c?.doNotTransfer).filter(Boolean).join(" ")}`.trim(),
  ]
    .filter(Boolean)
    .join(" ");
}

export function digestLocks(draft: ProjectDraft): string {
  return [
    draft.scene.sceneId,
    draft.scene.space,
    draft.task.goal,
    draft.blocking.map((b) => `${b.characterId}:${b.stance}:${b.eyeline}`).join("|"),
    draft.lines.map((l) => `${l.characterId}:${l.voiceId}`).join("|"),
  ].join("/");
}

export function asCompiled(
  prompt: string,
  provider: CompiledPrompt["provider"],
  usedFallback: boolean,
  draft: ProjectDraft,
): CompiledPrompt {
  return { prompt, provider, usedFallback, locksDigest: digestLocks(draft) };
}
