"use client";

import { useEffect, useRef, useState } from "react";
import type { Layer, Map as LeafletMap, Marker } from "leaflet";

export type LivePoint = { lat: number; lng: number; label?: string };

type RealMapProps = {
  origin?: LivePoint;
  destination?: LivePoint;
  driver?: LivePoint;
  currentLocation?: LivePoint;
  accuracyMeters?: number;
  nearbyDrivers?: LivePoint[];
  route?: Array<[number, number]>;
  pickPoint?: LivePoint;
  onPick?: (point: LivePoint) => void;
};

const CITY_PLACES = [
  { lat: -10.8349, lng: -38.5402, label: "Prefeitura", symbol: "P", tone: "blue" },
  { lat: -10.8389, lng: -38.5318, label: "Hospital", symbol: "+", tone: "red" },
  { lat: -10.8422, lng: -38.5299, label: "Rodoviária", symbol: "R", tone: "blue" },
  { lat: -10.8448, lng: -38.5365, label: "Praça Central", symbol: "●", tone: "green" },
] as const;

function near(a?: LivePoint, b?: LivePoint) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 0.00008 && Math.abs(a.lng - b.lng) < 0.00008;
}

function paddingFor(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const mobile = window.matchMedia("(max-width: 950px)").matches;
  const bottom = Number.parseFloat(styles.getPropertyValue("--map-safe-bottom")) || (mobile ? 118 : 62);
  return {
    topLeft: [mobile ? 44 : 64, mobile ? 72 : 64] as [number, number],
    bottomRight: [mobile ? 82 : 64, bottom] as [number, number],
  };
}

export function RealMap({
  origin,
  destination,
  driver,
  currentLocation,
  accuracyMeters,
  nearbyDrivers = [],
  route,
  pickPoint,
  onPick,
}: RealMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const placeMarkersRef = useRef<
    Array<{ marker: Marker; point: (typeof CITY_PLACES)[number] }>
  >([]);
  const driverMarkerRef = useRef<Marker | null>(null);
  const pickMarkerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  const refitRef = useRef<() => void>(() => undefined);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    let disposed = false;
    void import("leaflet").then((module) => {
      if (disposed || !elementRef.current) return;
      const L = module.default;
      const map = L.map(elementRef.current, {
        zoomControl: false,
        attributionControl: true,
        preferCanvas: true,
      }).setView([-10.8373, -38.5357], 14);
      const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      const contrast = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap, Tiles HOT",
      });
      const placeMarkers = CITY_PLACES.map((place) => {
          const icon = L.divIcon({
            className: `city-place-icon ${place.tone}`,
            html: `<span>${place.symbol}</span><b>${place.label}</b>`,
            iconSize: [34, 34],
            iconAnchor: [17, 17],
          });
          const marker = L.marker([place.lat, place.lng], { icon, riseOnHover: true }).bindTooltip(place.label, {
            direction: "top",
            offset: [0, -15],
            opacity: 0.96,
          });
          marker.on("click", () => marker.openTooltip());
          return { marker, point: place };
        });
      placeMarkersRef.current = placeMarkers;
      const points = L.layerGroup(placeMarkers.map(({ marker }) => marker)).addTo(map);
      L.control.layers({ Mapa: street, "Alto contraste": contrast }, { "Pontos rápidos": points }, { position: "topright" }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const updateZoomClass = () => elementRef.current?.classList.toggle("map-zoom-close", map.getZoom() >= 15);
      map.on("zoomend", updateZoomClass);
      updateZoomClass();
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      disposed = true;
      driverMarkerRef.current = null;
      pickMarkerRef.current = null;
      placeMarkersRef.current = [];
      refitRef.current = () => undefined;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const element = elementRef.current;
    if (!map || !element || !mapReady) return;
    let frame = 0;
    const refresh = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        refitRef.current();
      });
    };
    const observer = new ResizeObserver(refresh);
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("resize", refresh);
    document.addEventListener("moto-syxp:map-layout", refresh);
    const firstRefresh = window.setTimeout(refresh, 120);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      document.removeEventListener("moto-syxp:map-layout", refresh);
      window.clearTimeout(firstRefresh);
      window.cancelAnimationFrame(frame);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !onPickRef.current) return;
    const select = (event: { latlng: { lat: number; lng: number } }) =>
      onPickRef.current?.({ lat: event.latlng.lat, lng: event.latlng.lng, label: "Ponto selecionado" });
    map.on("click", select);
    return () => {
      map.off("click", select);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!pickPoint) {
      pickMarkerRef.current?.remove();
      pickMarkerRef.current = null;
      return;
    }
    void import("leaflet").then((module) => {
      const L = module.default;
      if (pickMarkerRef.current) {
        pickMarkerRef.current.setLatLng([pickPoint.lat, pickPoint.lng]);
      } else {
        const icon = L.divIcon({
          className: "map-pick-marker",
          html: '<span aria-hidden="true">●</span>',
          iconSize: [44, 44],
          iconAnchor: [22, 38],
        });
        const marker = L.marker([pickPoint.lat, pickPoint.lng], { icon, draggable: true })
          .addTo(map)
          .bindTooltip("Arraste para ajustar o ponto");
        marker.on("dragend", () => {
          const point = marker.getLatLng();
          onPickRef.current?.({ lat: point.lat, lng: point.lng, label: "Ponto selecionado" });
        });
        pickMarkerRef.current = marker;
      }
      map.flyTo([pickPoint.lat, pickPoint.lng], Math.max(map.getZoom(), 16), { duration: 0.55 });
    });
  }, [mapReady, pickPoint]);

  useEffect(() => {
    const map = mapRef.current;
    const element = elementRef.current;
    if (!map || !element || !mapReady) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled) return;
      const L = module.default;
      layersRef.current.forEach((layer) => layer.remove());
      layersRef.current = [];

      const importantPoints = [currentLocation, origin, destination, driver, ...nearbyDrivers].filter(
        (point): point is LivePoint => Boolean(point),
      );
      placeMarkersRef.current.forEach(({ marker, point }) => {
        const hidden = importantPoints.some(
          (important) =>
            Math.abs(important.lat - point.lat) < 0.00055 &&
            Math.abs(important.lng - point.lng) < 0.00055,
        );
        marker.setOpacity(hidden ? 0 : 1);
        const markerElement = marker.getElement();
        if (markerElement) markerElement.style.pointerEvents = hidden ? "none" : "auto";
      });

      const markerIcon = (kind: "current" | "origin" | "destination" | "driver") => {
        const label = kind === "current" ? "Você está aqui" : kind === "origin" ? "Origem" : kind === "destination" ? "Destino" : "Moto SyXp";
        const symbol = kind === "current" ? "" : kind === "origin" ? "O" : kind === "destination" ? "D" : "M";
        return L.divIcon({
          className: `route-marker ${kind}`,
          html: `<span aria-hidden="true"><i>${symbol}</i></span><b>${label}</b>`,
          iconSize: kind === "current" ? [42, 42] : [38, 44],
          iconAnchor: kind === "current" ? [21, 21] : [19, 40],
        });
      };

      const boundsPoints: Array<[number, number]> = [];
      if (currentLocation) {
        const radius = Math.min(Math.max(accuracyMeters || 18, 8), 250);
        layersRef.current.push(
          L.circle([currentLocation.lat, currentLocation.lng], {
            radius,
            color: "#0876f9",
            fillColor: "#3b91ff",
            fillOpacity: 0.15,
            weight: 2,
            interactive: false,
            className: "gps-accuracy-circle",
          }).addTo(map),
          L.marker([currentLocation.lat, currentLocation.lng], { icon: markerIcon("current"), zIndexOffset: 900 })
            .addTo(map)
            .bindTooltip(currentLocation.label || "Você está aqui", { direction: "top", offset: [0, -20] }),
        );
        boundsPoints.push([currentLocation.lat, currentLocation.lng]);
      }
      if (origin && !near(origin, currentLocation)) {
        layersRef.current.push(
          L.marker([origin.lat, origin.lng], { icon: markerIcon("origin"), zIndexOffset: 700 })
            .addTo(map)
            .bindTooltip(origin.label || "Origem", { direction: "top", offset: [0, -22] }),
        );
        boundsPoints.push([origin.lat, origin.lng]);
      }
      if (destination) {
        layersRef.current.push(
          L.marker([destination.lat, destination.lng], { icon: markerIcon("destination"), zIndexOffset: 750 })
            .addTo(map)
            .bindTooltip(destination.label || "Destino", { direction: "top", offset: [0, -22] }),
        );
        boundsPoints.push([destination.lat, destination.lng]);
      }
      nearbyDrivers.forEach((point) => {
        layersRef.current.push(
          L.marker([point.lat, point.lng], { icon: markerIcon("driver"), zIndexOffset: 500 })
            .addTo(map)
            .bindTooltip(point.label || "Motorista disponível", { direction: "top", offset: [0, -22] }),
        );
      });
      if (route?.length) {
        layersRef.current.push(
          L.polyline(route, { color: "#ffffff", weight: 9, opacity: 0.9, interactive: false }).addTo(map),
          L.polyline(route, { color: "#0876f9", weight: 5, opacity: 1, interactive: false }).addTo(map),
        );
        route.forEach((point) => boundsPoints.push(point));
      }
      if (driver) boundsPoints.push([driver.lat, driver.lng]);

      const refit = () => {
        if (!boundsPoints.length) return;
        if (boundsPoints.length === 1) {
          map.flyTo(boundsPoints[0], Math.max(map.getZoom(), 16), { duration: 0.55 });
          return;
        }
        const padding = paddingFor(element);
        map.fitBounds(L.latLngBounds(boundsPoints), {
          paddingTopLeft: padding.topLeft,
          paddingBottomRight: padding.bottomRight,
          maxZoom: 16,
          animate: true,
          duration: 0.55,
        });
      };
      refitRef.current = refit;
      window.requestAnimationFrame(refit);
    });
    return () => {
      cancelled = true;
    };
  }, [accuracyMeters, currentLocation, destination, driver, mapReady, nearbyDrivers, origin, route]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!driver) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      return;
    }
    void import("leaflet").then((module) => {
      const L = module.default;
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driver.lat, driver.lng]).setTooltipContent(driver.label || "Moto SyXp");
      } else {
        const icon = L.divIcon({
          className: "route-marker driver live-driver-marker",
          html: '<span aria-hidden="true"><i>M</i></span><b>Moto SyXp</b>',
          iconSize: [38, 44],
          iconAnchor: [19, 40],
        });
        driverMarkerRef.current = L.marker([driver.lat, driver.lng], { icon, zIndexOffset: 800 })
          .addTo(map)
          .bindTooltip(driver.label || "Moto SyXp", { direction: "top", offset: [0, -22] });
        if (!origin && !destination) map.flyTo([driver.lat, driver.lng], 16, { duration: 0.55 });
      }
    });
  }, [destination, driver, mapReady, origin]);

  return (
    <div
      ref={elementRef}
      className={`real-map ${onPick ? "is-picking" : ""}`}
      aria-label={onPick ? "Mapa para selecionar um endereço" : "Mapa OpenStreetMap da corrida"}
    />
  );
}
