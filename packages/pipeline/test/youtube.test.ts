import { describe, expect, it } from "vitest";
import type { PackageOut } from "@ys/agents";
import { buildPackage, chapterTime, type EpisodeState } from "../src/light.ts";

const voice = (sec: number) => ({ key: "k", mimeType: "audio/wav", durationMs: sec * 1000, words: [], estimatedTiming: false });

/** Sahne süreleri: 30, 5, 40, 30 sn (+ sahne arası 0,4 sn). */
const state: Pick<EpisodeState, "script" | "voice" | "voiceCredit" | "voiceProviderId"> = {
  script: { scenes: ["s1", "s2", "s3", "s4"].map((id) => ({ id, beatId: "b", narration: "", visualIntent: "", emotion: "", location: "" })) },
  voice: { s1: voice(30), s2: voice(5), s3: voice(40), s4: voice(30) },
  voiceProviderId: "voicevox:tts",
  voiceCredit: "VOICEVOX:ずんだもん",
};

const out: PackageOut = {
  titles: ["昭和の駄菓子屋の秘密", "  ", "失われたおもちゃ"],
  description: "昭和の子どもたちが通った駄菓子屋。",
  chapters: [
    { sceneId: "s2", title: "店の中" },
    { sceneId: "s1", title: "はじまり" },
    { sceneId: "s3", title: "おもちゃ" },
    { sceneId: "s4", title: "終わり" },
    { sceneId: "s9", title: "存在しない" },
  ],
  tags: ["#駄菓子屋", "昭和", "駄菓子屋", "Showa era"],
  hashtags: ["昭和レトロ", "#駄菓子"],
};

describe("YouTube paketi", () => {
  it("bölüm zamanını biçimler", () => {
    expect(chapterTime(0)).toBe("0:00");
    expect(chapterTime(65_400)).toBe("1:05");
    expect(chapterTime(3_725_000)).toBe("1:02:05");
  });

  it("bölümler 0:00'dan başlar, 10 sn'den kısa olan atlanır; atıf ve hashtag açıklamaya eklenir", () => {
    const pkg = buildPackage(state, out, "2026-10-31T00:00:00Z");
    // s3 (35,8 sn'de) s2'den (30,4 sn) yalnız 5,4 sn sonra: 10 sn kuralı yüzünden atlanır; bilinmeyen sahne atılır.
    expect(pkg.chapters).toEqual([
      { atMs: 0, title: "はじまり" },
      { atMs: 30_400, title: "店の中" },
      { atMs: 76_200, title: "終わり" },
    ]);
    expect(pkg.titles).toEqual(["昭和の駄菓子屋の秘密", "失われたおもちゃ"]);
    expect(pkg.tags).toEqual(["駄菓子屋", "昭和", "Showa era"]);
    expect(pkg.hashtags).toEqual(["#昭和レトロ", "#駄菓子"]);
    expect(pkg.description).toBe("昭和の子どもたちが通った駄菓子屋。\n\n0:00 はじまり\n0:30 店の中\n1:16 終わり\n\nVOICEVOX:ずんだもん\n\n#昭和レトロ #駄菓子");
  });

  it("üçten az bölüm kalırsa bölüm listesi yazılmaz; karakter adı okunamadıysa genel VOICEVOX atfı", () => {
    const pkg = buildPackage({ ...state, voiceCredit: undefined }, { ...out, chapters: out.chapters.slice(0, 2) });
    expect(pkg.chapters).toEqual([]);
    expect(pkg.credits).toEqual(["VOICEVOX"]);
    expect(pkg.description).not.toContain("0:00");
  });

  it("etiketlerin toplamı 450 karakteri geçmez", () => {
    const tags = Array.from({ length: 60 }, (_, i) => `etiket numarası ${i}`);
    const pkg = buildPackage(state, { ...out, tags });
    expect(pkg.tags.join(",").length).toBeLessThanOrEqual(450);
    expect(pkg.tags.length).toBeGreaterThan(10);
  });
});
