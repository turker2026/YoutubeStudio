import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { QueryFn } from "@ys/agents";
import { styleFromPack, stylePackOf } from "@ys/core";
import { InMemoryLedger, MediaGateway, pcm16ToWav, VoicevoxTtsAdapter } from "@ys/media-gateway";
import { FsAssetStore, type AssetStore } from "@ys/storage";
import {
  approve,
  EpisodePipeline,
  estimateEpisode,
  missingUploads,
  newEpisodeState,
  removeKeyframe,
  uploadKeyframe,
  type EpisodeInput,
  type EpisodeState,
} from "../src/index.ts";

/**
 * Kendi görsellerim + VOICEVOX, uçtan uca (para harcamaz): sahte VOICEVOX motoru sesi ve mora zamanlamasını verir,
 * sahte yönetmen çekimleri cümlecik indeksleriyle planlar, pipeline görseller yüklenene kadar bekler.
 */
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

const NARRATION = {
  s1: "昭和の駄菓子屋には、不思議なおもちゃが並んでいた。",
  s2: "子どもたちは、毎日そこに通った。",
};

/** Her cümlecik bir vurgu öbeği; 、 duraklaması öbeğin pause_mora'sı. */
function fakeEngine(): typeof fetch {
  return (async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/audio_query") {
      const text = url.searchParams.get("text")!;
      const clauses = text.split("、");
      const accent_phrases = clauses.map((c, i) => ({
        moras: [...c.replace(/[。、]/g, "")].map((ch) => ({ text: ch, vowel_length: 0.1, consonant_length: null })),
        pause_mora: i < clauses.length - 1 ? { text: "、", vowel_length: 0.3 } : null,
      }));
      return Response.json({ accent_phrases, speedScale: 1, prePhonemeLength: 0.1, postPhonemeLength: 0.1 });
    }
    if (url.pathname === "/synthesis") return new Response(new Uint8Array(pcm16ToWav(new Uint8Array(24_000 * 2 * 3), 24_000)), { headers: { "content-type": "audio/wav" } });
    if (url.pathname === "/speakers") return Response.json([{ name: "ずんだもん", styles: [{ name: "ノーマル", id: 3 }] }]);
    return new Response("yok", { status: 404 });
  }) as typeof fetch;
}

/** Sahte yönetmen: her sahnede iki çekim, ikincisi 1. cümlecikte başlar. */
function fakeClaude(): QueryFn {
  return ((params: { options?: { outputFormat?: { schema?: { properties?: Record<string, unknown> } } } }) => {
    const props = Object.keys(params.options?.outputFormat?.schema?.properties ?? {});
    const reply = (out: unknown) =>
      (async function* () {
        yield { type: "result", subtype: "success", duration_ms: 10, total_cost_usd: 0.001, structured_output: out };
      })();
    if (props.includes("titles")) {
      return reply({
        titles: ["駄菓子屋の思い出", "昭和のおもちゃ", "子どもの楽園"],
        description: "昭和の駄菓子屋へようこそ。",
        chapters: [{ sceneId: "s1", title: "店" }, { sceneId: "s2", title: "毎日" }],
        tags: ["駄菓子屋", "昭和"],
        hashtags: ["#昭和"],
      });
    }
    if (!props.includes("scenes")) throw new Error(`bilinmeyen ajan: ${props.join(",")}`);
    const shot = (startWord: number, what: string) => ({
      startWord,
      characterIds: ["c1"],
      locationId: "l1",
      kind: "ai_clip",
      description: what,
      imagePrompt: `Taro looks at ${what}`,
      motionPrompt: "",
      camera: "push_in",
      ambience: "none",
    });
    const out = { scenes: ["s1", "s2"].map((sceneId) => ({ sceneId, shots: [shot(0, "the shelves"), shot(1, "a spinning top")] })) };
    return (async function* () {
      yield { type: "result", subtype: "success", duration_ms: 10, total_cost_usd: 0.001, structured_output: out };
    })();
  }) as unknown as QueryFn;
}

const input: EpisodeInput = {
  topic: "昭和の駄菓子屋",
  lang: "ja",
  targetSec: 60,
  tier: "economy",
  aiClipRatio: 0,
  budgetUsd: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  imageSource: "upload",
  voiceId: "voicevox:3",
};

async function setup() {
  const store: AssetStore = new FsAssetStore(mkdtempSync(join(tmpdir(), "ys-upload-")));
  const gateway = new MediaGateway({
    providers: [new VoicevoxTtsAdapter("http://127.0.0.1:50021")],
    store,
    ledger: new InMemoryLedger(),
    fetch: fakeEngine(),
  });
  const pipeline = new EpisodePipeline({
    gateway,
    store,
    ledger: new InMemoryLedger(),
    workDir: mkdtempSync(join(tmpdir(), "ys-work-")),
    agentDeps: { queryFn: fakeClaude() },
  });
  const state: EpisodeState = {
    ...newEpisodeState(input),
    style: styleFromPack(stylePackOf("flat-explainer")!),
    story: { title: "駄菓子屋", logline: "", premise: "", hook: "", beats: [] },
    script: {
      scenes: Object.entries(NARRATION).map(([id, narration]) => ({ id, beatId: "b1", narration, visualIntent: "", emotion: "", location: "shop" })),
    } as never,
    cast: {
      characters: [{ id: "c1", name: "Taro", kind: "person", role: "boy", visualDescription: "boy in a striped shirt", scenes: ["s1", "s2"] }],
      locations: [{ id: "l1", name: "Dagashiya", visualDescription: "small wooden sweet shop", scenes: ["s1", "s2"] }],
    },
    done: { style: "x", story: "x", script: "x", cast: "x" },
    approvals: { script: "x" },
  };
  await pipeline.save(state);
  return { store, pipeline, id: state.id };
}

describe("kendi görsellerim + VOICEVOX (sahte motor ve Claude)", () => {
  it("konsept görsel üretmez, tasarım sayfası prompt'u verir; konsept seçimsiz onaylanır", async () => {
    const { pipeline, id } = await setup();
    const state = await pipeline.run(id, { until: "concept" });
    expect(state.concept).toEqual({ candidates: {}, selected: {} });
    expect(state.sheetPrompts?.c1).toContain("Character A: boy in a striped shirt");
    expect(() => approve(state, "concept")).not.toThrow();
  });

  it("ses ve çekim planından sonra görselleri bekler; yüklenip onaylanınca devam eder", async () => {
    const { store, pipeline, id } = await setup();
    let state = await pipeline.load(id);
    approve(state, "concept");
    await pipeline.save(state);
    state = await pipeline.run(id, { until: "keyframes" });

    // VOICEVOX: cümlecik zamanlaması ve kredi satırı.
    expect(state.voiceProviderId).toBe("voicevox:tts");
    expect(state.voiceCredit).toBe("VOICEVOX:ずんだもん");
    expect(state.voice!.s1!.words.map((w) => w.text)).toEqual(["昭和の駄菓子屋には、", "不思議なおもちゃが並んでいた。"]);
    expect(state.voice!.s1!.estimatedTiming).toBe(false);

    // Yönetmenin 1. cümlecik indeksi sahne içinde ikinci çekimi başlatır (boşluksuz yazıda da).
    expect(state.shots!.map((s) => s.id)).toEqual(["s1-sh1", "s1-sh2", "s2-sh1", "s2-sh2"]);
    expect(state.shots!.every((s) => s.kind === "still_motion")).toBe(true);
    const prompt = state.shots![0]!.uploadPrompt!;
    expect(prompt).toContain("Character A looks at the shelves");
    expect(prompt).not.toContain("Taro");
    expect(prompt).toContain("boy in a striped shirt");
    expect(prompt).toContain("16:9");

    expect(state.waitingFor).toBe("images");
    expect(state.done.keyframes).toBeUndefined();
    expect(() => approve(state, "images")).toThrow(/Görseli yüklenmemiş çekim/);

    await expect(uploadKeyframe(store, state, "s1-sh1", new TextEncoder().encode("<html>"))).rejects.toThrow(/Desteklenmeyen görsel/);
    for (const s of state.shots!) await uploadKeyframe(store, state, s.id, PNG);
    expect(missingUploads(state)).toEqual([]);
    expect(state.keyframes!["s1-sh1"]!.key).toMatch(/^assets\/uploads\/.+\/s1-sh1-[0-9a-f]{12}\.png$/);
    approve(state, "images");
    await pipeline.save(state);

    state = await pipeline.run(id, { until: "keyframes" });
    expect(state.done.keyframes).toBeDefined();

    // Paketleme: VOICEVOX kredisi açıklamada; videonun yanına youtube.txt yazılır.
    state = await pipeline.run(id, { only: "package" });
    expect(state.package!.titles[0]).toBe("駄菓子屋の思い出");
    expect(state.package!.description).toContain("VOICEVOX:ずんだもん");

    // Görsel kaldırılınca onay geri alınır, kareler yeniden denetlenir.
    removeKeyframe(state, "s2-sh2");
    expect(state.approvals?.images).toBeUndefined();
    expect(state.done.keyframes).toBeUndefined();
  });

  it("tahminde görsel ve ses parası sıfır, 'sağlayıcı yok' uyarısı çıkmaz", async () => {
    const state = newEpisodeState(input);
    const est = estimateEpisode(state, { providers: [new VoicevoxTtsAdapter("http://x")], latency: {} });
    expect(est.mode).toBe("still");
    const paid = est.rows.filter((r) => ["concept", "voice", "keyframes", "clips"].includes(r.stage)).reduce((n, r) => n + r.costUsd, 0);
    expect(paid).toBe(0);
    expect(est.warnings).toEqual([]);
    expect(est.rows.find((r) => r.stage === "voice")?.providerId).toBe("voicevox:tts");
  });
});
