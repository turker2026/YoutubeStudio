import type { PackageOut } from "@ys/agents";
import type { EpisodeState } from "./state.ts";
import { sceneOffsets, SCENE_GAP_MS } from "./timing.ts";

/*
 * YouTube paketi: ajanın metinleri + kodun kesin kuralları. YouTube bölümleri ancak ilki 0:00'da, en az üç tane ve her
 * biri en az 10 sn ise gösterir; etiketlerin toplamı 500 karakteri geçemez. Atıf satırları (VOICEVOX) modelden değil
 * durumdan gelir: unutulursa karakterin kullanım şartı çiğnenir.
 */

export interface YoutubePackage {
  at: string;
  titles: string[];
  /** Ajanın açıklaması (bölümler, krediler ve hashtag'ler hariç). */
  summary: string;
  chapters: { atMs: number; title: string }[];
  tags: string[];
  hashtags: string[];
  /** Zorunlu atıf satırları (ör. "VOICEVOX:ずんだもん"). */
  credits: string[];
  /** YouTube açıklama kutusuna olduğu gibi yapıştırılacak metin. */
  description: string;
}

const MIN_CHAPTER_MS = 10_000;
const TAGS_MAX_CHARS = 450;
const DESCRIPTION_MAX = 5000;

/** 65_000 → "1:05"; saatlik videoda "1:02:05". */
export function chapterTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** Ses sağlayıcısının istediği atıf; VOICEVOX'ta karakter adı okunamadıysa genel satır. */
export function voiceCredits(state: Pick<EpisodeState, "voiceCredit" | "voiceProviderId">): string[] {
  if (state.voiceCredit) return [state.voiceCredit];
  if (state.voiceProviderId?.startsWith("voicevox:")) return ["VOICEVOX"];
  return [];
}

export function buildPackage(state: Pick<EpisodeState, "script" | "voice" | "voiceCredit" | "voiceProviderId">, out: PackageOut, at = new Date().toISOString()): YoutubePackage {
  const sceneIds = state.script?.scenes.map((s) => s.id) ?? [];
  const voice = state.voice ?? {};
  const offsets = sceneOffsets(sceneIds, voice);
  const totalMs = sceneIds.reduce((n, id) => n + (voice[id]?.durationMs ?? 0) + SCENE_GAP_MS, 0);

  // Bölümler: bilinen sahneler, zamana göre sıralı, ilki 0:00; 10 sn'den kısa olanlar bir öncekine katılır.
  const bySceneId = new Map<string, { atMs: number; title: string }>();
  for (const c of out.chapters) {
    const atMs = offsets[c.sceneId];
    if (atMs === undefined || !c.title.trim() || bySceneId.has(c.sceneId)) continue;
    bySceneId.set(c.sceneId, { atMs, title: c.title.trim().slice(0, 60) });
  }
  const candidates = [...bySceneId.values()].sort((a, b) => a.atMs - b.atMs);
  if (candidates[0]) candidates[0].atMs = 0;
  const chapters: YoutubePackage["chapters"] = [];
  for (const c of candidates) {
    const prev = chapters.at(-1);
    if (prev && c.atMs - prev.atMs < MIN_CHAPTER_MS) continue;
    if (totalMs - c.atMs < MIN_CHAPTER_MS && prev) continue;
    chapters.push(c);
  }
  const usable = chapters.length >= 3 ? chapters : [];

  const tags: string[] = [];
  let tagChars = 0;
  for (const raw of out.tags) {
    const tag = raw.replace(/^#+/, "").replace(/[<>,]/g, " ").replace(/\s+/g, " ").trim();
    if (!tag || tags.some((t) => t.toLocaleLowerCase() === tag.toLocaleLowerCase())) continue;
    if (tagChars + tag.length + (tags.length ? 1 : 0) > TAGS_MAX_CHARS) break;
    tagChars += tag.length + (tags.length ? 1 : 0);
    tags.push(tag);
  }
  const hashtags = [...new Set(out.hashtags.map((h) => `#${h.replace(/^#+/, "").replace(/\s+/g, "")}`).filter((h) => h.length > 1))].slice(0, 3);
  const credits = voiceCredits(state);
  const titles = out.titles.map((t) => t.trim().slice(0, 100)).filter(Boolean);
  const summary = out.description.trim();

  const description = [
    summary,
    usable.length ? usable.map((c) => `${chapterTime(c.atMs)} ${c.title}`).join("\n") : "",
    credits.join("\n"),
    hashtags.join(" "),
  ]
    .filter(Boolean)
    .join("\n\n")
    .slice(0, DESCRIPTION_MAX);

  return { at, titles, summary, chapters: usable, tags, hashtags, credits, description };
}

/** Render klasörüne yazılan düz metin (Stüdyo'suz çalışanlar için). */
export function packageText(pkg: YoutubePackage): string {
  return [
    "# Başlık seçenekleri / Titles",
    ...pkg.titles.map((t, i) => `${i + 1}. ${t}`),
    "",
    "# Açıklama / Description",
    pkg.description,
    "",
    "# Etiketler / Tags",
    pkg.tags.join(", "),
    "",
  ].join("\n");
}
