import { voicevoxVoices } from "../../../lib/server";

/** Seçilebilir yerel sesler (VOICEVOX). Bulut sesleri sabit listede (`lib/voices.ts`). */
export async function GET() {
  return Response.json(await voicevoxVoices());
}
