import { anonymizeNames, castAliases } from "./names.ts";
import type { EpisodeState, PlannedShotState } from "./state.ts";

/*
 * Kendi görsellerim (yükleme modu): görseli kullanıcı kendi aracında (ChatGPT vb.) üretir. Bu yüzden prompt her
 * görselde tek başına yeterli olmalı: stil, karakterin sabit tarifi, mekân, palet ve kare kuralları her seferinde
 * tekrar yazılır. Görsel modelin referans görseli yok; tutarlılık tariflerin kelimesi kelimesine aynı kalmasından gelir.
 */

/** Görsel aracına yapıştırılan kare kuralları (pipeline'ın FRAME_RULES'ıyla aynı amaç, sohbet modeline uygun dil). */
export const UPLOAD_FRAME_RULES =
  "One single full-bleed illustration, one moment from one camera angle. No borders, no panels, no comic layout, no collage, no split screen. No text, no letters, no captions, no speech bubbles, no signs with writing, no watermark.";

function aspectText(state: Pick<EpisodeState, "input">): string {
  const { width, height } = state.input;
  if (width === height) return "Square 1:1 image.";
  return width > height
    ? "Wide 16:9 landscape image (if 16:9 is not available, use the widest landscape size)."
    : "Tall 9:16 portrait image (if 9:16 is not available, use the tallest portrait size).";
}

function styleLines(state: Pick<EpisodeState, "style">): string[] {
  const style = state.style;
  if (!style) return [];
  return [
    `Art style: ${style.promptPrefix.replace(/[,\s]+$/, "")}.`,
    style.palette.length ? `Colour palette: ${style.palette.join(", ")}.` : "",
    style.negativeRules.length ? `Avoid: ${style.negativeRules.join(", ")}.` : "",
  ].filter(Boolean);
}

/** Çekimin görsel prompt'u: kullanıcı ChatGPT'ye olduğu gibi yapıştırır. */
export function uploadPromptFor(state: Pick<EpisodeState, "input" | "style" | "cast">, shot: Pick<PlannedShotState, "imagePrompt" | "characterIds" | "locationId">): string {
  const all = state.cast?.characters ?? [];
  const aliases = castAliases(all);
  const chars = (shot.characterIds ?? []).map((id) => all.find((c) => c.id === id)).filter((c) => c !== undefined);
  const loc = shot.locationId ? state.cast?.locations.find((l) => l.id === shot.locationId) : undefined;
  return [
    `Scene: ${anonymizeNames(shot.imagePrompt, all).replace(/\.?\s*$/, ".")}`,
    ...chars.map((c) => `${aliases.get(c.id)} (keep exactly the same look in every image): ${anonymizeNames(c.visualDescription, all)}`),
    loc ? `Setting — ${loc.name}: ${loc.visualDescription}` : "",
    ...styleLines(state),
    aspectText(state),
    UPLOAD_FRAME_RULES,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Karakter ve mekân tasarım sayfası prompt'u (Konsept sekmesi). Kullanıcı önce bunları üretip aynı sohbette karelere
 * referans yaparsa ChatGPT karakteri daha tutarlı çizer.
 */
export function sheetPrompts(state: Pick<EpisodeState, "input" | "style" | "cast">): Record<string, string> {
  const all = state.cast?.characters ?? [];
  const aliases = castAliases(all);
  const out: Record<string, string> = {};
  for (const c of all) {
    out[c.id] = [
      `Character design sheet of ${aliases.get(c.id)}: ${anonymizeNames(c.visualDescription, all)}`,
      "Front view and three-quarter view, full body, neutral pose, plain light background.",
      ...styleLines(state),
      "No text, no labels, no watermark.",
    ].join("\n");
  }
  for (const l of state.cast?.locations ?? []) {
    out[l.id] = [`Establishing illustration of ${l.name}, empty of people: ${l.visualDescription}`, ...styleLines(state), aspectText(state), UPLOAD_FRAME_RULES].join("\n");
  }
  return out;
}
