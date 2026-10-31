import { describe, expect, it } from "vitest";
import { isUnspacedLang, narrationLength, splitWords } from "../src/text.ts";

describe("splitWords", () => {
  it("boşluklu yazıyı kelimelere böler", () => {
    expect(splitWords("Merhaba  dünya, nasılsın")).toEqual(["Merhaba", "dünya,", "nasılsın"]);
  });

  it("Japoncayı cümleciklere böler; kapanış ayracı önceki parçada kalır", () => {
    expect(splitWords("昭和の駄菓子屋には、不思議なおもちゃが並んでいた。「これは何？」と少年は聞いた！")).toEqual([
      "昭和の駄菓子屋には、",
      "不思議なおもちゃが並んでいた。",
      "「これは何？」",
      "と少年は聞いた！",
    ]);
  });
});

describe("narrationLength", () => {
  it("Japoncada noktalamasız karakter, diğerlerinde kelime sayar", () => {
    expect(isUnspacedLang("ja")).toBe(true);
    expect(isUnspacedLang("tr")).toBe(false);
    expect(narrationLength("昭和の、駄菓子屋。", "ja")).toBe(7);
    expect(narrationLength("bir iki üç", "tr")).toBe(3);
  });
});
