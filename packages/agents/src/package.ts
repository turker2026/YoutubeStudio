import { z } from "zod";
import { models, runStructured, type AgentDeps, type AgentResult } from "./runner.ts";
import type { ScriptOut, StoryOut } from "./schemas.ts";

/*
 * Paketleme: YouTube başlığı, açıklaması, bölümleri ve etiketleri. Metinler bölümün dilinde. Bölüm zamanları,
 * etiket sınırı ve zorunlu atıf satırları (VOICEVOX kredisi) kodda eklenir; modele bırakılmaz.
 */

export const PackageOut = z.object({
  titles: z
    .array(z.string())
    .min(3)
    .max(3)
    .describe("Three alternative video titles in the episode language, each under 70 characters, best first"),
  description: z
    .string()
    .describe(
      "Video description in the episode language, 80–200 words. The first two lines are the hook shown before 'more'. No links, no timestamps, no hashtags, no credits (added by code).",
    ),
  chapters: z
    .array(z.object({ sceneId: z.string(), title: z.string().describe("Short chapter title in the episode language, max 40 characters") }))
    .describe("YouTube chapters: the scene where each new part starts. The first must be the first scene. 3–8 chapters."),
  tags: z.array(z.string()).describe("10–20 search tags (no #): episode language first, then a few English ones"),
  hashtags: z.array(z.string()).max(3).describe("Up to 3 hashtags in the episode language, each starting with #"),
});
export type PackageOut = z.infer<typeof PackageOut>;

export function packager(
  brief: { lang: string; topic: string },
  story: StoryOut,
  script: ScriptOut,
  deps?: AgentDeps,
): Promise<AgentResult<PackageOut>> {
  const scenes = script.scenes.map((s) => ({ id: s.id, narration: s.narration }));
  return runStructured(
    {
      name: "packager",
      model: models().fast,
      effort: "low",
      schema: PackageOut,
      system: `You package a finished animated YouTube video for upload. Write every viewer-facing field in the episode language: ${brief.lang}.
Rules:
- Titles: specific and curiosity-driven, promise only what the video delivers; no ALL CAPS, no emoji spam, no "you won't believe".
- Description: open with the hook in two short lines, then summarise what the viewer learns. Never invent facts that are not in the script.
- Chapters: group scenes into 3–8 parts that match the story beats; first chapter is the first scene.
- Tags: what people would type into YouTube search for this topic; no duplicates, no single generic words like "video".
- Use natural, native phrasing for ${brief.lang} (for Japanese: natural Japanese YouTube style, not translated English).`,
      prompt: `Topic: ${brief.topic}\nWorking title: ${story.title}\nLogline: ${story.logline}\n\nScenes:\n${JSON.stringify(scenes, null, 2)}`,
    },
    deps,
  );
}
