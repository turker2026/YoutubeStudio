"use client";

import type { EpisodeState, PlannedShotState } from "@ys/pipeline/light";
import { Check, ClipboardCopy, Clapperboard, ImagePlus, Trash2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import type { EpisodeResponse } from "../../../lib/types";
import { useI18n } from "../../locale-provider";
import { asset, type Act } from "./parts";

/** Yüklemeden önce tarayıcıda küçültülür (uzun kenar en çok bu kadar): istek gövdesi küçük kalır, video 1080p. */
const MAX_SIDE = 2560;

/**
 * Görseli JPEG data URL'ine çevirir. ChatGPT PNG'leri 3–5 MB olabiliyor; JPEG %92 ile ~1 MB'a iner ve videoda fark
 * görünmez. Tarayıcı çözemezse (bozuk dosya) hata verir; sunucu yine de türünü baytlardan denetler.
 */
async function prepareImage(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.92);
}

/** Toplu yüklemede eşleştirme: adı çekim kimliği olan dosya ("s1-sh2.png") o çekime, kalanlar ad sırasıyla boş çekimlere. */
function assign(files: File[], shots: PlannedShotState[], filled: (id: string) => boolean): [string, File][] {
  const byName = (f: File) => f.name.replace(/\.[^.]+$/, "");
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const ids = new Set(shots.map((s) => s.id));
  const plan: [string, File][] = sorted.filter((f) => ids.has(byName(f))).map((f) => [byName(f), f]);
  const open = shots.map((s) => s.id).filter((id) => !filled(id) && !plan.some(([p]) => p === id));
  sorted.filter((f) => !ids.has(byName(f))).slice(0, open.length).forEach((f, i) => plan.push([open[i]!, f]));
  return plan;
}

function useCopy() {
  const [copied, setCopied] = useState<string>();
  return {
    copied,
    copy: async (key: string, text: string) => {
      await navigator.clipboard.writeText(text).catch(() => {});
      setCopied(key);
      setTimeout(() => setCopied((c) => (c === key ? undefined : c)), 1500);
    },
  };
}

/** Kopyalanabilir prompt kutusu (çekim ve tasarım sayfası prompt'ları). */
export function PromptBox({ id, text }: { id: string; text?: string }) {
  const { t } = useI18n();
  const { copied, copy } = useCopy();
  if (!text) return null;
  return (
    <div className="relative">
      <pre className="max-h-40 overflow-auto rounded-lg bg-panel-2 p-2.5 pr-10 text-[11px] leading-relaxed whitespace-pre-wrap text-muted">{text}</pre>
      <button
        type="button"
        className="absolute top-1.5 right-1.5 rounded-md bg-black/60 p-1 text-white/80 hover:text-white"
        title={t("upload.copy")}
        onClick={() => copy(id, text)}
      >
        {copied === id ? <Check size={14} className="text-ok" /> : <ClipboardCopy size={14} />}
      </button>
    </div>
  );
}

/** Çekimin o anda duyulan anlatımı (kelime zamanlamalarından); görseli üretirken bağlam olsun. */
function spokenDuring(state: EpisodeState, shot: PlannedShotState): string {
  const ids = state.script?.scenes.map((s) => s.id) ?? [];
  let offset = 0;
  for (const id of ids) {
    if (id === shot.sceneId) break;
    offset += (state.voice?.[id]?.durationMs ?? 0) + 400; // pipeline timing.ts SCENE_GAP_MS
  }
  const words = state.voice?.[shot.sceneId]?.words ?? [];
  return words
    .filter((w) => w.startMs + offset >= shot.startMs - 50 && w.startMs + offset < shot.endMs)
    .map((w) => w.text)
    .join(" ");
}

/** Kendi görsellerim: her çekimin prompt'u, yükleme ve onay. */
export function UploadShots({ data, busy, act }: { data: EpisodeResponse; busy: boolean; act: Act }) {
  const { t } = useI18n();
  const { state } = data;
  const shots = state.shots ?? [];
  const [progress, setProgress] = useState<{ done: number; total: number }>();
  const [failed, setFailed] = useState<string[]>([]);
  const bulk = useRef<HTMLInputElement>(null);
  const { copied, copy } = useCopy();
  const filled = (id: string) => Boolean(state.keyframes?.[id]);
  const count = shots.filter((s) => filled(s.id)).length;
  const approved = Boolean(state.approvals?.images);
  const working = busy || progress !== undefined;

  async function upload(pairs: [string, File][]) {
    setFailed([]);
    setProgress({ done: 0, total: pairs.length });
    const errors: string[] = [];
    for (const [i, [shotId, file]] of pairs.entries()) {
      try {
        const ok = await act({ type: "upload-keyframe", shotId, dataUrl: await prepareImage(file) });
        if (!ok) errors.push(file.name);
      } catch {
        errors.push(file.name);
      }
      setProgress({ done: i + 1, total: pairs.length });
    }
    setProgress(undefined);
    setFailed(errors);
  }

  const allPrompts = shots.map((s, i) => `#${i + 1} (${s.id})\n${s.uploadPrompt ?? ""}`).join("\n\n");

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 rounded-xl border border-accent/40 bg-accent/5 p-4 text-sm">
        <div className="flex flex-wrap items-center gap-3">
          <span className="font-medium">{t("upload.progress", { n: count, total: shots.length })}</span>
          <div className="ml-auto flex flex-wrap gap-2">
            <button className="btn-ghost py-1.5 text-xs" onClick={() => copy("all", allPrompts)}>
              {copied === "all" ? <Check size={14} /> : <ClipboardCopy size={14} />} {t("upload.copyAll")}
            </button>
            <button className="btn-ghost py-1.5 text-xs" disabled={working} onClick={() => bulk.current?.click()}>
              <Upload size={14} /> {t("upload.bulk")}
            </button>
            {!approved && (
              <button
                className="btn-primary py-1.5 text-xs"
                disabled={working || count < shots.length}
                onClick={() => act({ type: "approve-images" })}
              >
                <Clapperboard size={14} /> {t("upload.approve")}
              </button>
            )}
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted">{t("upload.help")}</p>
        {progress && <p className="text-xs text-run">{t("upload.uploading", { n: progress.done, total: progress.total })}</p>}
        {failed.length > 0 && <p className="text-xs text-bad">{t("upload.failed", { files: failed.join(", ") })}</p>}
        <input
          ref={bulk}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])];
            e.target.value = "";
            if (files.length) void upload(assign(files, shots, filled));
          }}
        />
      </div>

      <ol className="grid gap-3">
        {shots.map((s, i) => (
          <UploadRow key={s.id} state={state} shot={s} index={i} disabled={working} onUpload={(f) => upload([[s.id, f]])} act={act} />
        ))}
      </ol>
    </div>
  );
}

function UploadRow({
  state,
  shot,
  index,
  disabled,
  onUpload,
  act,
}: {
  state: EpisodeState;
  shot: PlannedShotState;
  index: number;
  disabled: boolean;
  onUpload: (file: File) => void;
  act: Act;
}) {
  const { t } = useI18n();
  const input = useRef<HTMLInputElement>(null);
  const ref = state.keyframes?.[shot.id];
  const spoken = spokenDuring(state, shot);
  return (
    <li className={`grid gap-3 rounded-xl border p-3 md:grid-cols-[220px_minmax(0,1fr)] ${ref ? "border-line" : "border-dashed border-muted/60"}`}>
      <div className="grid content-start gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => input.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const f = e.dataTransfer.files[0];
            if (f && !disabled) onUpload(f);
          }}
          className="overflow-hidden rounded-lg border border-line bg-panel-2 enabled:hover:border-muted"
        >
          {ref ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={asset(ref.key)} alt={shot.id} className="aspect-video w-full object-cover" />
          ) : (
            <div className="grid aspect-video place-items-center gap-1 text-xs text-muted">
              <ImagePlus size={20} />
              {t("upload.drop")}
            </div>
          )}
        </button>
        <div className="flex items-center justify-between text-[11px] text-muted">
          <span>
            <span className="font-semibold text-white">#{index + 1}</span> · {shot.id} · {((shot.endMs - shot.startMs) / 1000).toFixed(1)} {t("unit.sec")}
          </span>
          {ref && (
            <button type="button" className="hover:text-bad" disabled={disabled} title={t("upload.remove")} onClick={() => act({ type: "remove-keyframe", shotId: shot.id })}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f) onUpload(f);
          }}
        />
      </div>
      <div className="grid content-start gap-2 text-sm">
        <p className="text-[13px] leading-relaxed">{shot.description}</p>
        {spoken && <p className="text-xs text-muted">🎙 {spoken}</p>}
        <PromptBox id={shot.id} text={shot.uploadPrompt} />
      </div>
    </li>
  );
}
