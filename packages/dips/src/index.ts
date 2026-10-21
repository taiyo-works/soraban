// @soraban/dips：通報ゲートウェイ（Sprint 12b）。純粋な TypeScript のパッケージ（DB・Next.js・@soraban/regulations に依存しない）。
export * from "./types";
export * from "./fields";
export * from "./policy";
export * from "./messages";
export * from "./validate";
export * from "./fingerprint";
export * from "./prepare";
export * from "./transitions";
export * from "./config";
export * from "./gateway";
export * from "./status";
export * from "./sha256";
export { ManualGateway } from "./adapters/manual";
export {
  MockGateway,
  formatRegistrationDatetime,
  MOCK_REJECTED_MESSAGE,
  MOCK_SERVER_ERROR_MESSAGE,
  MOCK_TIMEOUT_MESSAGE,
  MOCK_UNAUTHORIZED_MESSAGE,
  MOCK_UNKNOWN_STATUS_RAW,
} from "./adapters/mock";
