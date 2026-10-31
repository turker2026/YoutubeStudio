import type { RunStatus, Stage } from "@ys/pipeline/light";
import type { MessageKey, Translate } from "./i18n";

/** Durum rozetinin metni: "Çalışıyor · Kareler", "Onay bekliyor · Senaryo". */
export function statusLabel(t: Translate, st: { status: RunStatus; stage?: Stage }): string {
  const base = t(`status.${st.status}` as MessageKey);
  if (!st.stage || st.status === "done" || st.status === "idle") return base;
  // Bekleme, kapının açtığı aşamada görünür; rozet onaylanacak şeyi söylesin.
  const gate = st.stage === "voice" ? "step.concept" : st.stage === "keyframes" ? "step.images" : "step.script";
  const what = st.status === "waiting" ? t(gate) : t(`stage.${st.stage}` as MessageKey);
  return `${base} · ${what}`;
}
