"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";

export type LivePoint = { lat: number; lng: number; label?: string };

type RealMapProps = {
  origin?: LivePoint;
  destination?: LivePoint;
  driver?: LivePoint;
  nearbyDrivers?: LivePoint[];
  route?: Array<[number, number]>;
  pickPoint?: LivePoint;
  onPick?: (point: LivePoint) => void;
};

const CITY_PLACES = [
  {
    lat: -10.8349,
    lng: -38.5402,
    label: "Prefeitura",
    symbol: "P",
    tone: "blue",
  },
  { lat: -10.8389, lng: -38.5318, label: "Hospital", symbol: "+", tone: "red" },
  {
    lat: -10.8422,
    lng: -38.5299,
    label: "Rodoviária",
    symbol: "R",
    tone: "blue",
  },
  {
    lat: -10.8448,
    lng: -38.5365,
    label: "Praça Central",
    symbol: "●",
    tone: "green",
  },
] as const;

export function RealMap({
  origin,
  destination,
  driver,
  nearbyDrivers = [],
  route,
  pickPoint,
  onPick,
}: RealMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Array<Marker | Polyline>>([]);
  const driverMarkerRef = useRef<Marker | null>(null);
  const pickMarkerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
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
      }).setView([-10.8373, -38.5357], 14);
      const street = L.tileLayer(
        "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "© OpenStreetMap" },
      ).addTo(map);
      const contrast = L.tileLayer(
        "https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png",
        { maxZoom: 19, attribution: "© OpenStreetMap, Tiles HOT" },
      );
      const points = L.layerGroup(
        CITY_PLACES.map((place) => {
          const icon = L.divIcon({
            className: `city-place-icon ${place.tone}`,
            html: `<span>${place.symbol}</span><b>${place.label}</b>`,
            iconSize: [120, 34],
            iconAnchor: [17, 17],
          });
          return L.marker([place.lat, place.lng], { icon }).bindTooltip(
            place.label,
          );
        }),
      ).addTo(map);
      L.control
        .layers(
          { Mapa: street, "Alto contraste": contrast },
          { "Pontos rápidos": points },
          { position: "bottomright" },
        )
        .addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      mapRef.current = map;
      setMapReady(true);
    });
    return () => {
      disposed = true;
      driverMarkerRef.current = null;
      pickMarkerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !onPickRef.current) return;
    const select = (event: { latlng: { lat: number; lng: number } }) =>
      onPickRef.current?.({
        lat: event.latlng.lat,
        lng: event.latlng.lng,
        label: "Ponto selecionado",
      });
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
          className: "live-map-icon map-pick-marker",
          html: "<span>●</span>",
          iconSize: [44, 44],
          iconAnchor: [22, 38],
        });
        const marker = L.marker([pickPoint.lat, pickPoint.lng], {
          icon,
          draggable: true,
        })
          .addTo(map)
          .bindTooltip("Arraste para ajustar o ponto");
        marker.on("dragend", () => {
          const point = marker.getLatLng();
          onPickRef.current?.({
            lat: point.lat,
            lng: point.lng,
            label: "Ponto selecionado",
          });
        });
        pickMarkerRef.current = marker;
      }
      map.setView([pickPoint.lat, pickPoint.lng], Math.max(map.getZoom(), 16));
    });
  }, [mapReady, pickPoint]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    void import("leaflet").then((module) => {
      const L = module.default;
      layersRef.current.forEach((layer) => layer.remove());
      layersRef.current = [];
      const icon = (kind: "origin" | "destination" | "driver") =>
        L.divIcon({
          className: `live-map-icon ${kind}`,
          html: `<span>${kind === "driver" ? "M" : kind === "origin" ? "P" : "D"}</span>`,
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
      const points: LivePoint[] = [];
      if (origin) {
        layersRef.current.push(
          L.marker([origin.lat, origin.lng], { icon: icon("origin") })
            .addTo(map)
            .bindTooltip(origin.label || "Embarque"),
        );
        points.push(origin);
      }
      if (destination) {
        layersRef.current.push(
          L.marker([destination.lat, destination.lng], {
            icon: icon("destination"),
          })
            .addTo(map)
            .bindTooltip(destination.label || "Destino"),
        );
        points.push(destination);
      }
      nearbyDrivers.forEach((point) => {
        layersRef.current.push(
          L.marker([point.lat, point.lng], { icon: icon("driver") })
            .addTo(map)
            .bindTooltip(point.label || "Motorista disponível"),
        );
        points.push(point);
      });
      if (route?.length) {
        const line = L.polyline(route, {
          color: "#0876f9",
          weight: 5,
          opacity: 0.9,
        }).addTo(map);
        layersRef.current.push(line);
      }
      if (points.length === 1) map.setView([points[0].lat, points[0].lng], 16);
      if (points.length > 1)
        map.fitBounds(
          L.latLngBounds(points.map((point) => [point.lat, point.lng])),
          { padding: [55, 55], maxZoom: 16 },
        );
    });
  }, [origin, destination, nearbyDrivers, route, mapReady]);

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
        driverMarkerRef.current
          .setLatLng([driver.lat, driver.lng])
          .setTooltipContent(driver.label || "Moto SyXp");
      } else {
        const icon = L.divIcon({
          className: "live-map-icon driver live-driver-marker",
          html: "<span>M</span>",
          iconSize: [38, 38],
          iconAnchor: [19, 19],
        });
        driverMarkerRef.current = L.marker([driver.lat, driver.lng], { icon })
          .addTo(map)
          .bindTooltip(driver.label || "Moto SyXp");
        if (!origin && !destination) map.setView([driver.lat, driver.lng], 16);
      }
    });
  }, [destination, driver, mapReady, origin]);

  return (
    <div
      ref={elementRef}
      className={`real-map ${onPick ? "is-picking" : ""}`}
      aria-label={
        onPick
          ? "Mapa para selecionar um endereço"
          : "Mapa OpenStreetMap da corrida"
      }
    />
  );
}
