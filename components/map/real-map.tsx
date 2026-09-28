"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker, Polyline } from "leaflet";

export type LivePoint = { lat: number; lng: number; label?: string };

export function RealMap({ origin, destination, driver, nearbyDrivers = [], route }: { origin?: LivePoint; destination?: LivePoint; driver?: LivePoint; nearbyDrivers?: LivePoint[]; route?: Array<[number, number]> }) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Array<Marker | Polyline>>([]);
  const driverMarkerRef = useRef<Marker | null>(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    let disposed = false;
    void import("leaflet").then((module) => {
      if (disposed || !elementRef.current) return;
      const L = module.default;
      const map = L.map(elementRef.current, { zoomControl: false, attributionControl: true }).setView([-10.8373, -38.5357], 14);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
      L.control.zoom({ position: "topright" }).addTo(map);
      mapRef.current = map; setMapReady(true);
    });
    return () => { disposed = true; driverMarkerRef.current = null; mapRef.current?.remove(); mapRef.current = null; };
  }, []);

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    void import("leaflet").then((module) => {
      const L = module.default;
      layersRef.current.forEach((layer) => layer.remove()); layersRef.current = [];
      const icon = (kind: "origin" | "destination" | "driver") => L.divIcon({ className: `live-map-icon ${kind}`, html: `<span>${kind === "driver" ? "M" : kind === "origin" ? "P" : "D"}</span>`, iconSize: [38, 38], iconAnchor: [19, 19] });
      const points: LivePoint[] = [];
      if (origin) { layersRef.current.push(L.marker([origin.lat, origin.lng], { icon: icon("origin") }).addTo(map).bindTooltip(origin.label || "Embarque")); points.push(origin); }
      if (destination) { layersRef.current.push(L.marker([destination.lat, destination.lng], { icon: icon("destination") }).addTo(map).bindTooltip(destination.label || "Destino")); points.push(destination); }
      nearbyDrivers.forEach((point) => { layersRef.current.push(L.marker([point.lat, point.lng], { icon: icon("driver") }).addTo(map).bindTooltip(point.label || "Motorista disponível")); points.push(point); });
      if (route?.length) { const line = L.polyline(route, { color: "#0876f9", weight: 5, opacity: .9 }).addTo(map); layersRef.current.push(line); }
      if (points.length === 1) map.setView([points[0].lat, points[0].lng], 16);
      if (points.length > 1) map.fitBounds(L.latLngBounds(points.map((point) => [point.lat, point.lng])), { padding: [55, 55], maxZoom: 16 });
    });
  }, [origin, destination, nearbyDrivers, route, mapReady]);

  useEffect(() => {
    const map = mapRef.current; if (!map || !mapReady) return;
    if (!driver) { driverMarkerRef.current?.remove(); driverMarkerRef.current = null; return; }
    void import("leaflet").then((module) => {
      const L = module.default;
      if (driverMarkerRef.current) {
        driverMarkerRef.current.setLatLng([driver.lat, driver.lng]).setTooltipContent(driver.label || "Moto VIP");
      } else {
        const icon = L.divIcon({ className: "live-map-icon driver live-driver-marker", html: "<span>M</span>", iconSize: [38, 38], iconAnchor: [19, 19] });
        driverMarkerRef.current = L.marker([driver.lat, driver.lng], { icon }).addTo(map).bindTooltip(driver.label || "Moto VIP");
        if (!origin && !destination) map.setView([driver.lat, driver.lng], 16);
      }
    });
  }, [destination, driver, mapReady, origin]);

  return <div ref={elementRef} className="real-map" aria-label="Mapa OpenStreetMap da corrida" />;
}
