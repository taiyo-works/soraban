export type GeocodeResult = {
  readonly title: string;
  readonly addressCode: string;
  readonly lat: number;
  readonly lng: number;
};

export const searchAddress = async (query: string): Promise<readonly GeocodeResult[]> => {
  const trimmed = query.trim();
  if (trimmed.length === 0) return [];
  const res = await fetch(`/api/geocode?q=${encodeURIComponent(trimmed)}`);
  if (!res.ok) throw new Error(`geocode ${res.status}`);
  const data = (await res.json()) as { results?: readonly GeocodeResult[] };
  return data.results ?? [];
};
