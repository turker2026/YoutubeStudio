/**
 * Anlatım metnini zamanlama birimlerine böler. Boşluklu dillerde birim kelimedir; Japonca/Çince gibi boşluksuz
 * yazılarda cümleciktir (、。！？ sonrası). Yönetmenin çekim indeksleri, ses zamanlaması ve altyazılar aynı birimi
 * kullanmalı: biri boşluktan, diğeri noktalamadan bölerse çekimler yanlış kelimede başlar.
 */

/** Hiragana, katakana, CJK ideogramları ve yarım genişlikli katakana. */
const CJK = /[぀-ヿ㐀-鿿豈-﫿ｦ-ﾟ]/;

/** Boşluksuz yazıda bölünme noktası: cümlecik sonu noktalaması (ve hemen ardından gelen kapanış ayraçları). */
const CJK_BREAK = /(?<=[、。！？!?，；：…][」』）)】]*)(?![」』）)】])|\s+/;

/** Boşluksuz (CJK) yazı mı? Dil kodu yerine metne bakılır: ajan çıktısının dili her zaman bilinmiyor. */
export function isUnspacedText(text: string): boolean {
  return CJK.test(text);
}

/** Boşluksuz yazan diller; uzunluk kelime yerine karakterle ölçülür. */
export function isUnspacedLang(lang: string): boolean {
  return ["ja", "zh"].includes(lang.split("-")[0]!.toLowerCase());
}

export function splitWords(text: string): string[] {
  const parts = isUnspacedText(text) ? text.split(CJK_BREAK) : text.split(/\s+/);
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Anlatım uzunluğu: boşluklu dillerde kelime, boşluksuzlarda (noktalama ve boşluk hariç) karakter sayısı. */
export function narrationLength(text: string, lang: string): number {
  if (!isUnspacedLang(lang)) return text.split(/\s+/).filter(Boolean).length;
  return text.replace(/[\s、。！？!?，；：…「」『』（）()【】・]/g, "").length;
}
