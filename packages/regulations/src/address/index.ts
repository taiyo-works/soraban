// 住所検索（Sprint 9）。同梱索引のデータを含むため、サーバー側（/api/geocode）からだけ import する
// （@soraban/regulations の index からは型と定数だけを公開し、ブラウザのバンドルに索引を入れない）。
export { searchBundledAddress, prepareAddressIndex, addressParcelsBundled } from "./search";
export { normalizeAddress, normalizeName, kanjiNumberToArabic, arabicToKanjiNumber } from "./normalize";
export * from "./types";
