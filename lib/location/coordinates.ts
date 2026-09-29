export type ExactCoordinates = {
  lat: number;
  lng: number;
};

export class LocationCoordinateError extends Error {}

export function isValidCoordinates(point: ExactCoordinates) {
  return (
    Number.isFinite(point.lat) &&
    Number.isFinite(point.lng) &&
    point.lat >= -90 &&
    point.lat <= 90 &&
    point.lng >= -180 &&
    point.lng <= 180
  );
}

export function coordinatesFromGeolocation(coords: {
  latitude: number;
  longitude: number;
}): ExactCoordinates {
  const point = { lat: coords.latitude, lng: coords.longitude };
  if (!isValidCoordinates(point)) {
    throw new LocationCoordinateError(
      "O GPS retornou coordenadas inválidas. Tente novamente.",
    );
  }
  return point;
}

export function preserveExactCoordinates<T extends ExactCoordinates>(
  exact: ExactCoordinates,
  description: T,
): T {
  if (!isValidCoordinates(exact)) {
    throw new LocationCoordinateError("As coordenadas selecionadas são inválidas.");
  }
  return { ...description, lat: exact.lat, lng: exact.lng };
}

export function geolocationErrorMessage(code: number) {
  if (code === 1)
    return "Permissão de localização negada. Pesquise ou selecione o ponto no mapa.";
  if (code === 2)
    return "Localização indisponível. Verifique o GPS ou selecione o ponto manualmente.";
  if (code === 3)
    return "O GPS demorou para responder. Pesquise ou selecione o ponto no mapa.";
  return "Não foi possível obter sua localização. Pesquise ou selecione o ponto no mapa.";
}
