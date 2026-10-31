import { describe, expect, it } from "vitest";
import {
  ElevenLabsTtsAdapter,
  GeminiTtsAdapter,
  moraWordTimings,
  pcm16ToWav,
  rankProviders,
  VoicevoxTtsAdapter,
  voicevoxStyleId,
  wavDurationMs,
  type AudioQuery,
  type GenerationRequest,
} from "../src/index.ts";

const mora = (text: string, v = 0.1, c?: number) => ({ text, vowel_length: v, consonant_length: c ?? null });

/** 「昭和の駄菓子屋、楽しい。」: iki cümlecik, aralarında 、 duraklaması. */
const QUERY: AudioQuery = {
  accent_phrases: [
    { moras: [mora("ショ", 0.1, 0.05), mora("ウ"), mora("ワ"), mora("ノ")], pause_mora: null },
    { moras: [mora("ダ"), mora("ガ"), mora("シ"), mora("ヤ")], pause_mora: mora("、", 0.3) },
    { moras: [mora("タ"), mora("ノ"), mora("シ"), mora("イ")], pause_mora: null },
  ],
  speedScale: 1,
  pitchScale: 0,
  prePhonemeLength: 0.1,
  postPhonemeLength: 0.1,
  outputSamplingRate: 24000,
};

/** Toplam plan süresi: 0.1 + 0.85 (ilk grup) + 0.3 + 0.4 + 0.1 = 1.75 sn. */
const silence = (sec: number) => pcm16ToWav(new Uint8Array(Math.round(sec * 24_000) * 2), 24_000);

function engine() {
  const calls: { url: string; body?: string }[] = [];
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: typeof init?.body === "string" ? init.body : undefined });
    if (url.includes("/audio_query")) return new Response(JSON.stringify(QUERY), { headers: { "content-type": "application/json" } });
    if (url.includes("/synthesis")) return new Response(new Uint8Array(silence(1.75)), { headers: { "content-type": "audio/wav" } });
    if (url.endsWith("/speakers")) {
      return new Response(JSON.stringify([{ name: "ずんだもん", styles: [{ name: "ノーマル", id: 3 }] }, { name: "四国めたん", styles: [{ name: "ノーマル", id: 2 }] }]));
    }
    return new Response("yok", { status: 404 });
  }) as typeof fetch;
  return { fetch: fetchFn, calls };
}

describe("VOICEVOX", () => {
  it("WAV süresini başlıktan okur", () => {
    expect(wavDurationMs(silence(1.75))).toBe(1750);
    expect(wavDurationMs(new Uint8Array([1, 2, 3]))).toBeUndefined();
  });

  it("ses kimliğinden stil numarasını çıkarır", () => {
    expect(voicevoxStyleId("voicevox:13")).toBe(13);
    expect(voicevoxStyleId("JBFqnCBsd6RMkjVDRZzb")).toBeUndefined();
    expect(voicevoxStyleId("voicevox:abc")).toBeUndefined();
  });

  it("duraklama moralarından cümlecik zamanlaması çıkarır", () => {
    expect(moraWordTimings("昭和の駄菓子屋、楽しい。", QUERY, 1750)).toEqual([
      { text: "昭和の駄菓子屋、", startMs: 100, endMs: 950 },
      { text: "楽しい。", startMs: 1250, endMs: 1650 },
    ]);
    // Hız çarpanı: gerçek süre yarıysa zamanlar da yarıya ölçeklenir.
    expect(moraWordTimings("昭和の駄菓子屋、楽しい。", QUERY, 875)[1]).toEqual({ text: "楽しい。", startMs: 625, endMs: 825 });
  });

  it("cümlecik sayısı tutmazsa konuşma süresini karakter sayısına göre paylaştırır", () => {
    const words = moraWordTimings("昭和の駄菓子屋…楽しい「すごい」", QUERY, 1750);
    expect(words.map((w) => w.text)).toEqual(["昭和の駄菓子屋…", "楽しい「すごい」"]);
    expect(words[0]!.startMs).toBe(100);
    expect(words.at(-1)!.endMs).toBe(1650);
  });

  it("audio_query + synthesis ile WAV ve kelime zamanlaması üretir", async () => {
    const { fetch, calls } = engine();
    const adapter = new VoicevoxTtsAdapter("http://127.0.0.1:50021", { speedScale: 1.2 });
    const res = await adapter.generate(
      { capability: "tts_timestamps", quality: "standard", text: "昭和の駄菓子屋、楽しい。", voiceId: "voicevox:2", language: "ja" },
      { fetch },
    );
    expect(calls[0]!.url).toContain("/audio_query?text=");
    expect(calls[0]!.url).toContain("speaker=2");
    expect(calls[1]!.url).toBe("http://127.0.0.1:50021/synthesis?speaker=2");
    expect(JSON.parse(calls[1]!.body!).speedScale).toBe(1.2);
    expect(res.files[0]!.mimeType).toBe("audio/wav");
    expect(res.words).toHaveLength(2);
  });

  it("kredi satırını motordaki karakter adından üretir", async () => {
    const { fetch } = engine();
    const adapter = new VoicevoxTtsAdapter("http://127.0.0.1:50021");
    expect(await adapter.credit(undefined, { fetch })).toBe("VOICEVOX:ずんだもん");
    expect(await adapter.credit("voicevox:2", { fetch })).toBe("VOICEVOX:四国めたん");
  });

  it("motor kapalıyken ne yapılacağını söyler", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    const adapter = new VoicevoxTtsAdapter("http://127.0.0.1:50021");
    await expect(adapter.generate({ capability: "tts", quality: "standard", text: "こんにちは" }, { fetch })).rejects.toThrow(/VOICEVOX uygulaması açık mı/);
  });

  it("yalnız Japonca ve kendi sesleri için seçilir; VOICEVOX sesi başka sağlayıcıya düşmez", () => {
    const vv = new VoicevoxTtsAdapter("http://x");
    const el = new ElevenLabsTtsAdapter("k");
    const gem = new GeminiTtsAdapter({ id: "gemini:tts", model: "m", apiKey: "k", qualityPrior: 0.75, price: { unit: "per_1k_chars", usd: 0.03 } });
    const ids = (req: Partial<GenerationRequest>) =>
      rankProviders([vv, el, gem], { capability: "tts", quality: "standard", text: "x", ...req }, { tier: "economy" }).map((r) => r.adapter.id);
    expect(ids({ language: "ja", voiceId: "voicevox:3" })).toEqual(["voicevox:tts"]);
    expect(ids({ language: "ja" })[0]).toBe("voicevox:tts");
    expect(ids({ language: "ja", voiceId: "JBFqnCBsd6RMkjVDRZzb" })).not.toContain("voicevox:tts");
    expect(ids({ language: "tr" })).not.toContain("voicevox:tts");
    expect(ids({ language: "tr", voiceId: "voicevox:3" })).toEqual([]);
  });
});
