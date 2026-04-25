export type RegulationSource = "国" | "都道府県" | "市町村";

export type RegulationStatus = "red" | "yellow" | "green";

export type Regulation = {
  readonly id: string;
  readonly source: RegulationSource;
  readonly authority: string;
  readonly title: string;
  readonly summary: string;
  readonly url?: string;
};

export type RegulationCheckResult = {
  readonly status: RegulationStatus;
  readonly regulations: readonly Regulation[];
};
