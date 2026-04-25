export type LatLng = {
  readonly lat: number;
  readonly lng: number;
};

export const isValidLatLng = ({ lat, lng }: LatLng): boolean =>
  Number.isFinite(lat) && Number.isFinite(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;

export const YONAGO_CITY_HALL: LatLng = {
  lat: 35.4283,
  lng: 133.3306,
};
