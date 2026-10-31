import { splitWords, type Capability, type WordTiming } from "@ys/core";
import { wavDurationMs } from "../audio.ts";
import { requestBytes, requestJson } from "../http.ts";
import type {
  GenerateContext,
  GenerationRequest,
  GenerationResult,
  PriceRule,
  PriceSource,
  ProviderAdapter,
  ProviderLimits,
} from "../types.ts";

/*
 * VOICEVOX Engine: yerel, ücretsiz Japonca TTS (varsayılan http://127.0.0.1:50021). İki adım: /audio_query metni
 * mora mora seslendirme planına çevirir (her moranın süresi saniye cinsinden), /synthesis bu planı WAV'a çevirir.
 * Kelime zamanlaması plandaki mora sürelerinden çıkar; ayrıca hizalama gerekmez.
 * API: https://voicevox.github.io/voicevox_engine/api/
 */

export const VOICEVOX_PREFIX = "voicevox:";

/** Ses kimliği verilmezse: ずんだもん (ノーマル), VOICEVOX'un en bilinen sesi. */
export const VOICEVOX_DEFAULT_STYLE = 3;

const SOURCE: PriceSource = {
  url: "https://voicevox.hiroshiba.jp/term/",
  checked: "2026-10-31",
  note: "Yerel motor, ücretsiz. Ticari kullanım serbest ama her karakterin kendi şartı var; videoda 'VOICEVOX:<karakter>' kredisi zorunlu (açıklamaya otomatik yazılır)",
};

interface Mora {
  text: string;
  consonant_length?: number | null;
  vowel_length: number;
}

interface AccentPhrase {
  moras: Mora[];
  pause_mora?: Mora | null;
}

/** /audio_query yanıtı (yalnız kullanılan alanlar; geri kalanı olduğu gibi /synthesis'e döner). */
export interface AudioQuery {
  accent_phrases: AccentPhrase[];
  speedScale: number;
  prePhonemeLength: number;
  postPhonemeLength: number;
  /** Yeni motor sürümlerinde var: duraklama moralarının çarpanı. */
  pauseLengthScale?: number;
  [key: string]: unknown;
}

export interface VoicevoxSpeaker {
  name: string;
  speaker_uuid?: string;
  styles: { name: string; id: number; type?: string }[];
}

/** "voicevox:3" → 3; ön ek yoksa ya da sayı değilse undefined. */
export function voicevoxStyleId(voiceId: string | undefined): number | undefined {
  if (!voiceId?.startsWith(VOICEVOX_PREFIX)) return undefined;
  const n = Number(voiceId.slice(VOICEVOX_PREFIX.length));
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

/** Motordaki karakterler ve stilleri. Stüdyo ses listesi ve kredi satırı buradan gelir. */
export async function voicevoxSpeakers(baseUrl: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<VoicevoxSpeaker[]> {
  return reach(baseUrl, () => requestJson<VoicevoxSpeaker[]>(fetchFn, `${baseUrl}/speakers`, { signal }));
}

/** Motor kapalıyken fetch "fetch failed" atar; kullanıcıya ne yapacağını söyleyen hataya çevrilir. */
async function reach<T>(baseUrl: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof TypeError) throw new Error(`VOICEVOX motoruna ulaşılamadı (${baseUrl}). VOICEVOX uygulaması açık mı? (${e.message})`);
    throw e;
  }
}

const moraSec = (m: Mora) => (m.consonant_length ?? 0) + m.vowel_length;

/**
 * Mora sürelerinden cümlecik zamanlamaları. Metin `splitWords` ile bölünür (yönetmenin çekim indeksleri de aynı
 * birimi kullanır); duraklama moraları (、。！？) cümlecik sınırıdır. Sayılar tutmazsa (ayraç, "…" gibi duraklama
 * üretmeyen işaretler) konuşma süresi karakter sayısına göre paylaştırılır. Süreler gerçek WAV süresine ölçeklenir:
 * hız çarpanı ve motor sürümü farkı böylece hataya dönüşmez.
 */
export function moraWordTimings(text: string, query: AudioQuery, durationMs: number): WordTiming[] {
  const clauses = splitWords(text);
  if (clauses.length === 0) return [];

  const pauseScale = query.pauseLengthScale ?? 1;
  let t = query.prePhonemeLength;
  const speechStart = t;
  const groups: { start: number; end: number }[] = [];
  let start: number | undefined;
  for (const phrase of query.accent_phrases) {
    for (const m of phrase.moras) {
      start ??= t;
      t += moraSec(m);
    }
    if (phrase.pause_mora) {
      if (start !== undefined) groups.push({ start, end: t });
      start = undefined;
      t += moraSec(phrase.pause_mora) * pauseScale;
    }
  }
  if (start !== undefined) groups.push({ start, end: t });
  const speechEnd = t;
  const total = t + query.postPhonemeLength;
  const scale = total > 0 ? durationMs / 1000 / total : 0;
  const ms = (sec: number) => Math.round(sec * scale * 1000);

  if (groups.length === clauses.length) {
    return clauses.map((c, i) => ({ text: c, startMs: ms(groups[i]!.start), endMs: ms(groups[i]!.end) }));
  }
  const weights = clauses.map((c) => c.length);
  const sum = weights.reduce((a, b) => a + b, 0);
  let cursor = speechStart;
  return clauses.map((c, i) => {
    const len = ((speechEnd - speechStart) * weights[i]!) / sum;
    const word = { text: c, startMs: ms(cursor), endMs: ms(cursor + len) };
    cursor += len;
    return word;
  });
}

export interface VoicevoxOptions {
  /** Ses kimliği verilmediğinde kullanılan stil. */
  defaultStyle?: number;
  /** Konuşma hızı çarpanı (1 = motor varsayılanı). */
  speedScale?: number;
}

/** Yerel VOICEVOX motoru: Japonca anlatım, mora zamanlamalı. */
export class VoicevoxTtsAdapter implements ProviderAdapter {
  readonly local = true;
  readonly capabilities: readonly Capability[] = ["tts", "tts_timestamps"];
  readonly limits: ProviderLimits = { languages: ["ja"], voiceIdPrefix: VOICEVOX_PREFIX };
  readonly id = "voicevox:tts";
  readonly qualityPrior = 0.8;
  readonly price: PriceRule = { unit: "free" };
  readonly priceSource = SOURCE;
  private speakers?: Promise<VoicevoxSpeaker[]>;

  constructor(
    private readonly baseUrl: string,
    private readonly opts: VoicevoxOptions = {},
  ) {}

  private styleOf(voiceId: string | undefined): number {
    return voicevoxStyleId(voiceId) ?? this.opts.defaultStyle ?? VOICEVOX_DEFAULT_STYLE;
  }

  async generate(req: GenerationRequest, ctx: GenerateContext): Promise<GenerationResult> {
    if (!req.text) throw new Error("VOICEVOX için metin gerekli");
    const speaker = this.styleOf(req.voiceId);
    const qs = new URLSearchParams({ text: req.text, speaker: String(speaker) });
    const query = await reach(this.baseUrl, () =>
      requestJson<AudioQuery>(ctx.fetch, `${this.baseUrl}/audio_query?${qs}`, { method: "POST", signal: ctx.signal }),
    );
    if (this.opts.speedScale && this.opts.speedScale !== 1) query.speedScale = this.opts.speedScale;
    const audio = await reach(this.baseUrl, () =>
      requestBytes(ctx.fetch, `${this.baseUrl}/synthesis?speaker=${speaker}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "audio/wav" },
        body: JSON.stringify(query),
        signal: ctx.signal,
      }),
    );
    const durationMs = wavDurationMs(audio.bytes);
    return {
      files: [{ bytes: audio.bytes, mimeType: "audio/wav" }],
      words: durationMs ? moraWordTimings(req.text, query, durationMs) : undefined,
    };
  }

  async credit(voiceId: string | undefined, ctx: GenerateContext): Promise<string> {
    const style = this.styleOf(voiceId);
    this.speakers ??= voicevoxSpeakers(this.baseUrl, ctx.fetch, ctx.signal).catch((e) => {
      this.speakers = undefined;
      throw e;
    });
    const speaker = (await this.speakers).find((s) => s.styles.some((st) => st.id === style));
    return speaker ? `VOICEVOX:${speaker.name}` : "VOICEVOX";
  }
}
