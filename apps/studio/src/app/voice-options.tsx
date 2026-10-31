"use client";

import { useEffect, useState } from "react";
import { VOICES } from "../lib/voices";
import { useI18n } from "./locale-provider";

export interface LocalVoice {
  id: string;
  name: string;
}

interface VoicevoxResponse {
  enabled: boolean;
  voices: LocalVoice[];
  error?: string;
}

/** Yerel VOICEVOX motorundaki sesler (motor kapalıysa ya da tanımlı değilse boş). */
export function useVoicevox(): VoicevoxResponse | undefined {
  const [data, setData] = useState<VoicevoxResponse>();
  useEffect(() => {
    let alive = true;
    fetch("/api/voices")
      .then((r) => (r.ok ? (r.json() as Promise<VoicevoxResponse>) : undefined))
      .then((d) => alive && d && setData(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
  return data;
}

export const isVoicevox = (voiceId: string | undefined) => Boolean(voiceId?.startsWith("voicevox:"));

/** Ses seçimi: bulut sesleri + motordaki VOICEVOX karakterleri. Seçili ses listede yoksa (motor kapalı) yine gösterilir. */
export function VoiceOptions({ voicevox, current }: { voicevox?: VoicevoxResponse; current?: string }) {
  const { t } = useI18n();
  const local = voicevox?.voices ?? [];
  const orphan = isVoicevox(current) && !local.some((v) => v.id === current);
  return (
    <>
      {VOICES.map((v) => (
        <option key={v.id} value={v.id}>
          {t(v.label)}
        </option>
      ))}
      {(local.length > 0 || orphan) && (
        <optgroup label={t("voice.voicevoxGroup")}>
          {orphan && <option value={current}>{current}</option>}
          {local.map((v) => (
            <option key={v.id} value={v.id}>
              {v.name}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}

/** Seçilebilir VOICEVOX sesi yoksa nedenini söyler (tanımlı ama motor kapalı). */
export function VoicevoxHint({ voicevox }: { voicevox?: VoicevoxResponse }) {
  const { t } = useI18n();
  if (!voicevox?.enabled || voicevox.voices.length > 0) return null;
  return <p className="mt-1 text-xs text-muted">{t("voice.voicevoxOffline")}</p>;
}
