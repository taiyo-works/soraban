// Sprint 12b 契約 12：ゲートウェイの契約テスト群を、手動と模擬で同じように流す。API は skip（理由と件数を表示）。
import { ManualGateway } from "./adapters/manual";
import { MockGateway } from "./adapters/mock";
import { contractAdapter, gatewayContract } from "./gateway-contract";

gatewayContract([contractAdapter("manual", () => new ManualGateway()), contractAdapter("mock", () => new MockGateway())]);
