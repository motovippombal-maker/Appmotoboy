"use client";

import { useEffect, useRef, useState } from "react";
import type { Layer, Map as LeafletMap, Marker } from "leaflet";
import {
  mapViewportKey,
  shouldAutoFitViewport,
} from "@/lib/map/viewport";
import { routeChevrons } from "@/lib/map/route-chevrons";
import type { RoadPackage } from "@/lib/offline/road-graph";

export type LivePoint = { lat: number; lng: number; label?: string };
const NO_NEARBY_DRIVERS: LivePoint[] = [];
const NO_LANDMARKS: Array<{ lat: number; lng: number; label: string; category: string }> = [];

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
  centerTarget?: LivePoint;
  centerRequest?: number;
  navigation?: { position: LivePoint; heading: number | null; zoom: number };
  navigationMode?: boolean;
  navigationFollow?: boolean;
  onNavigationInteraction?: () => void;
  compactRoute?: boolean;
  trackingBadge?: { title: string; detail: string };
  followDriver?: boolean;
  landmarks?: Array<{ lat: number; lng: number; label: string; category: string }>;
  offlineRoads?: RoadPackage | null;
  offlineMapActive?: boolean;
  diagnostics?: boolean;
};

function near(a?: LivePoint, b?: LivePoint) {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 0.00008 && Math.abs(a.lng - b.lng) < 0.00008;
}

function safeMarkerLabel(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character] || character);
}

function paddingFor(element: HTMLElement) {
  const styles = getComputedStyle(element);
  const mobile = window.matchMedia("(max-width: 950px)").matches;
  const mapRect = element.getBoundingClientRect();
  const sheet = element.closest(".passenger-shell")?.querySelector(".ride-sheet");
  const sheetRect = sheet?.getBoundingClientRect();
  const sheetOverlapsMap = sheetRect && sheetRect.left < mapRect.right && sheetRect.right > mapRect.left;
  const sheetBottom = sheetOverlapsMap ? Math.max(0, mapRect.bottom - sheetRect.top + 24) : 0;
  const configuredBottom = Number.parseFloat(styles.getPropertyValue("--map-safe-bottom")) || (mobile ? 118 : 62);
  const top = mobile ? 72 : 64;
  const bottom = Math.min(sheetBottom || configuredBottom, Math.max(24, element.clientHeight - top - 120));
  return {
    topLeft: [mobile ? 44 : 64, top] as [number, number],
    bottomRight: [mobile ? Math.min(138, Math.round(element.clientWidth * 0.35)) : 64, bottom] as [number, number],
  };
}

export function RealMap({
  origin,
  destination,
  driver,
  currentLocation,
  accuracyMeters,
  nearbyDrivers = NO_NEARBY_DRIVERS,
  route,
  pickPoint,
  onPick,
  centerTarget,
  centerRequest = 0,
  navigation,
  navigationMode = false,
  navigationFollow = true,
  onNavigationInteraction,
  compactRoute = false,
  trackingBadge,
  followDriver = false,
  landmarks = NO_LANDMARKS,
  offlineRoads,
  offlineMapActive = false,
  diagnostics = false,
}: RealMapProps) {
  const elementRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layersRef = useRef<Layer[]>([]);
  const driverMarkerRef = useRef<Marker | null>(null);
  const driverMarkerModeRef = useRef<boolean | null>(null);
  const driverMarkerBadgeRef = useRef("");
  const pickMarkerRef = useRef<Marker | null>(null);
  const onPickRef = useRef(onPick);
  const centerTargetRef = useRef(centerTarget);
  const driverBoundsRef = useRef(driver);
  const onNavigationInteractionRef = useRef(onNavigationInteraction);
  const refitRef = useRef<() => void>(() => undefined);
  const lastAutoFitKeyRef = useRef("");
  const [mapReady, setMapReady] = useState(false);
  const offlineLayerRef = useRef<Layer | null>(null);
  const trackingBadgeTitle = trackingBadge?.title;
  const trackingBadgeDetail = trackingBadge?.detail;
  const driverLat = driver?.lat;
  const driverLng = driver?.lng;

  useEffect(() => {
    onPickRef.current = onPick;
  }, [onPick]);

  useEffect(() => {
    centerTargetRef.current = centerTarget;
  }, [centerTarget]);

  useEffect(() => {
    driverBoundsRef.current = driver;
  }, [driver]);

  useEffect(() => {
    onNavigationInteractionRef.current = onNavigationInteraction;
  }, [onNavigationInteraction]);

  useEffect(() => {
    if (!elementRef.current || mapRef.current) return;
    let disposed = false;
    void import("leaflet").then(async (module) => {
      await import("@tomickigrzegorz/leaflet-rotate");
      if (disposed || !elementRef.current) return;
      const L = module.default;
      const map = L.map(elementRef.current, {
        zoomControl: false,
        attributionControl: true,
        preferCanvas: false,
        rotate: true,
      }).setView([-10.8373, -38.5357], 14);
      if (diagnostics && process.env.NODE_ENV !== "production") {
        const bounds = elementRef.current.getBoundingClientRect();
        console.info("[DRIVER_MAP] mounting", { width: bounds.width, height: bounds.height });
      }
      const street = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      }).addTo(map);
      const contrast = L.tileLayer("https://{s}.tile.openstreetmap.fr/hot/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap, Tiles HOT",
      });
      if (diagnostics) {
        let tileErrors = 0;
        street.on("load", () => {
          tileErrors = 0;
          if (process.env.NODE_ENV !== "production") console.info("[DRIVER_MAP] tiles loaded");
        });
        street.on("tileerror", (event) => {
          console.error("[DRIVER_MAP] tile error", event);
          tileErrors += 1;
          if (tileErrors >= 3 && map.hasLayer(street)) {
            map.removeLayer(street);
            contrast.addTo(map);
          }
        });
      }
      L.control.layers({ Mapa: street, "Alto contraste": contrast }, undefined, { position: "topright" }).addTo(map);
      L.control.zoom({ position: "bottomright" }).addTo(map);
      const updateZoomClass = () => elementRef.current?.classList.toggle("map-zoom-close", map.getZoom() >= 15);
      map.on("zoomend", updateZoomClass);
      map.on("dragstart", () => onNavigationInteractionRef.current?.());
      updateZoomClass();
      mapRef.current = map;
      setMapReady(true);
      if (diagnostics && process.env.NODE_ENV !== "production") console.info("[DRIVER_MAP] map ready");
    });
    return () => {
      disposed = true;
      driverMarkerRef.current = null;
      driverMarkerModeRef.current = null;
      pickMarkerRef.current = null;
      refitRef.current = () => undefined;
      mapRef.current?.remove();
      mapRef.current = null;
      offlineLayerRef.current = null;
    };
  }, [diagnostics]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled) return;
      const L = module.default;
      offlineLayerRef.current?.remove();
      offlineLayerRef.current = null;
      if (offlineMapActive && offlineRoads) {
        const group = L.layerGroup().addTo(map);
        const renderer = L.svg({ padding: 0.2 });
        if (!map.getPane("offlineRoadPane")) {
          const pane = map.createPane("offlineRoadPane");
          pane.style.zIndex = "210";
        }
        for (const road of offlineRoads.roads) {
          const points = road.nodes.map((id) => offlineRoads.nodes[id]).filter(Boolean) as [number, number][];
          if (points.length < 2) continue;
          const major = /^(motorway|trunk|primary|secondary)/.test(road.highway);
          L.polyline(points, { renderer, pane: "offlineRoadPane", color: major ? "#e5b96b" : "#ffffff", weight: major ? 4 : 2.6,
            opacity: 1, interactive: false }).addTo(group);
        }
        const labels = new Set<string>();
        for (const road of offlineRoads.roads) {
          if (!road.name || labels.has(road.name) || labels.size >= 65 || road.nodes.length < 5) continue;
          labels.add(road.name);
          const point = offlineRoads.nodes[road.nodes[Math.floor(road.nodes.length / 2)]];
          if (!point) continue;
          L.marker(point, { interactive: false, icon: L.divIcon({ className: "offline-road-name", html: safeMarkerLabel(road.name), iconSize: [100, 14], iconAnchor: [50, 7] }) }).addTo(group);
        }
        for (const place of offlineRoads.places || []) {
          L.marker([place.lat, place.lng], { interactive: false, icon: L.divIcon({ className: "offline-place-name", html: safeMarkerLabel(place.name), iconSize: [120, 20], iconAnchor: [60, 10] }) }).addTo(group);
        }
        offlineLayerRef.current = group;
        map.attributionControl?.addAttribution('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors · ODbL</a>');
      } else {
        map.attributionControl?.removeAttribution('<a href="https://www.openstreetmap.org/copyright">© OpenStreetMap contributors · ODbL</a>');
      }
    });
    return () => { cancelled = true; };
  }, [mapReady, offlineMapActive, offlineRoads]);

  useEffect(() => {
    const map = mapRef.current;
    const element = elementRef.current;
    if (!map || !element || !mapReady) return;
    let frame = 0;
    const refresh = (refit = false) => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        map.invalidateSize({ animate: false });
        if (refit && !navigationMode) refitRef.current();
      });
    };
    const refreshLayout = () => refresh(true);
    const observer = new ResizeObserver(() => refresh());
    observer.observe(element);
    if (element.parentElement) observer.observe(element.parentElement);
    window.addEventListener("resize", refreshLayout);
    window.visualViewport?.addEventListener("resize", refreshLayout);
    document.addEventListener("moto-syxp:map-layout", refreshLayout);
    const firstRefresh = window.setTimeout(refreshLayout, 120);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", refreshLayout);
      window.visualViewport?.removeEventListener("resize", refreshLayout);
      document.removeEventListener("moto-syxp:map-layout", refreshLayout);
      window.clearTimeout(firstRefresh);
      window.cancelAnimationFrame(frame);
    };
  }, [mapReady, navigationMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || centerRequest <= 0) return;
    const target = centerTargetRef.current;
    if (target) {
      map.flyTo(
        [target.lat, target.lng],
        Math.max(map.getZoom(), 16),
        { duration: 0.55 },
      );
      return;
    }
    refitRef.current();
  }, [centerRequest, mapReady]);

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
    let updateChevrons: (() => void) | null = null;
    void import("leaflet").then((module) => {
      if (cancelled) return;
      const L = module.default;
      layersRef.current.forEach((layer) => layer.remove());
      layersRef.current = [];

      const markerIcon = (kind: "current" | "origin" | "destination" | "driver") => {
        const label = kind === "current" || kind === "origin"
          ? "Sua localização"
          : kind === "destination"
            ? (destination?.label?.split(",")[0] || "Destino")
            : "MotoPombal";
        const symbol = kind === "driver" ? "M" : "";
        return L.divIcon({
          className: `route-marker ${kind}`,
          html: `<span aria-hidden="true"><i>${symbol}</i></span><b>${safeMarkerLabel(label)}</b>`,
          iconSize: kind === "destination" ? [42, 52] : kind === "driver" ? [38, 44] : [42, 42],
          iconAnchor: kind === "destination" ? [21, 48] : kind === "driver" ? [19, 40] : [21, 21],
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
        );
        if (!route?.length || !near(origin, currentLocation)) {
          layersRef.current.push(
            L.marker([currentLocation.lat, currentLocation.lng], { icon: markerIcon("current"), zIndexOffset: 900 })
              .addTo(map)
              .bindTooltip(currentLocation.label || "Você está aqui", { direction: "top", offset: [0, -20] }),
          );
        }
        if (!route?.length) boundsPoints.push([currentLocation.lat, currentLocation.lng]);
      }
      if (origin && (route?.length || !near(origin, currentLocation))) {
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
      if ((trackingBadgeTitle || navigationMode) && driverBoundsRef.current) {
        boundsPoints.push([driverBoundsRef.current.lat, driverBoundsRef.current.lng]);
      }
      landmarks.forEach((point) => {
        const category = point.category.replace(/[^a-z_]/g, "");
        const icon = L.divIcon({
          className: `tracking-landmark category-${category}`,
          html: `<span aria-hidden="true"><svg viewBox="0 0 24 24" fill="none"><path d="M12 21s7-5.2 7-11a7 7 0 1 0-14 0c0 5.8 7 11 7 11Z" fill="currentColor"/><circle cx="12" cy="10" r="2.6" fill="#fff"/></svg></span><b>${safeMarkerLabel(point.label)}</b>`,
          iconSize: [24, 28], iconAnchor: [12, 27],
        });
        layersRef.current.push(L.marker([point.lat, point.lng], { icon, interactive: false, zIndexOffset: 80 }).addTo(map));
      });
      nearbyDrivers.forEach((point) => {
        layersRef.current.push(
          L.marker([point.lat, point.lng], { icon: markerIcon("driver"), zIndexOffset: 500 })
            .addTo(map)
            .bindTooltip(point.label || "Motorista disponível", { direction: "top", offset: [0, -22] }),
        );
      });
      if (route?.length) {
        const routeStyle = { interactive: false, lineCap: "round" as const, lineJoin: "round" as const };
        layersRef.current.push(
          L.polyline(route, { ...routeStyle, color: "#ffffff", weight: compactRoute ? 11 : 17, opacity: 1 }).addTo(map),
          L.polyline(route, { ...routeStyle, color: "#0868f9", weight: compactRoute ? 7 : 12, opacity: 1 }).addTo(map),
        );
        const chevronGroup = L.layerGroup().addTo(map);
        layersRef.current.push(chevronGroup);
        updateChevrons = () => {
          chevronGroup.clearLayers();
          if (compactRoute) return;
          const projected = route.map(([lat, lng]) => map.latLngToLayerPoint([lat, lng]));
          const arrows = routeChevrons(projected).map((chevron) =>
            chevron.map((point) => map.layerPointToLatLng([point.x, point.y])),
          );
          if (arrows.length) {
            L.polyline(arrows, {
              ...routeStyle,
              color: "#ffffff",
              weight: 2.5,
              opacity: 1,
            }).addTo(chevronGroup);
          }
        };
        updateChevrons();
        map.on("zoomend", updateChevrons);
        route.forEach((point) => boundsPoints.push(point));
      }
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
      const nextAutoFitKey = trackingBadgeTitle
        ? `tracking:${origin?.lat ?? ""}:${origin?.lng ?? ""}:${destination?.lat ?? ""}:${destination?.lng ?? ""}:${route?.length ? "route" : "waiting"}`
        : mapViewportKey({ origin, destination, route });
      if (navigationMode) {
        if (shouldAutoFitViewport(lastAutoFitKeyRef.current, nextAutoFitKey)) {
          lastAutoFitKeyRef.current = nextAutoFitKey;
          window.requestAnimationFrame(refit);
        }
      } else if (!nextAutoFitKey) {
        lastAutoFitKeyRef.current = "";
      } else if (
        shouldAutoFitViewport(lastAutoFitKeyRef.current, nextAutoFitKey)
      ) {
        lastAutoFitKeyRef.current = nextAutoFitKey;
        window.requestAnimationFrame(refit);
      }
    });
    return () => {
      cancelled = true;
      if (updateChevrons) map.off("zoomend", updateChevrons);
    };
  }, [accuracyMeters, compactRoute, currentLocation, destination, landmarks, mapReady, nearbyDrivers, origin, route, navigationMode, trackingBadgeTitle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!driver) {
      driverMarkerRef.current?.remove();
      driverMarkerRef.current = null;
      driverMarkerModeRef.current = null;
      driverMarkerBadgeRef.current = "";
      return;
    }
    let cancelled = false;
    void import("leaflet").then((module) => {
      if (cancelled) return;
      const L = module.default;
      const badgeKey = trackingBadgeTitle ? `${trackingBadgeTitle}|${trackingBadgeDetail}` : "";
      const markerIcon = () => L.divIcon({
        className: `route-marker driver live-driver-marker ${trackingBadgeTitle ? "tracking-moto-marker" : ""}`,
        html: trackingBadgeTitle
          ? `<span aria-hidden="true"><img src="/brand/motopombal-moto-marker.svg" alt="" /></span><b><strong>${safeMarkerLabel(trackingBadgeTitle)}</strong><small>${safeMarkerLabel(trackingBadgeDetail || "")}</small></b>`
          : navigationMode ? '<span aria-hidden="true"><i>▲</i></span><b>MotoPombal</b>' : '<span aria-hidden="true"><i>M</i></span><b>MotoPombal</b>',
        iconSize: trackingBadgeTitle ? [56, 56] : [38, 44],
        iconAnchor: trackingBadgeTitle ? [28, 40] : [19, 40],
      });
      if (driverMarkerRef.current && driverMarkerModeRef.current !== navigationMode) {
        driverMarkerRef.current.remove();
        driverMarkerRef.current = null;
      }
      if (driverMarkerRef.current) {
        if (driverMarkerBadgeRef.current !== badgeKey) driverMarkerRef.current.setIcon(markerIcon());
        driverMarkerRef.current.setLatLng([driver.lat, driver.lng]).setTooltipContent(driver.label || "MotoPombal");
      } else {
        driverMarkerRef.current = L.marker([driver.lat, driver.lng], { icon: markerIcon(), zIndexOffset: 800 })
          .addTo(map)
          .bindTooltip(driver.label || "MotoPombal", { direction: "top", offset: [0, -22] });
        driverMarkerModeRef.current = navigationMode;
        if (!origin && !destination) map.flyTo([driver.lat, driver.lng], 16, { duration: 0.55 });
      }
      driverMarkerBadgeRef.current = badgeKey;
    });
    return () => {
      cancelled = true;
    };
  }, [destination, driver, mapReady, origin, navigationMode, trackingBadgeTitle, trackingBadgeDetail]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !followDriver || driverLat === undefined || driverLng === undefined) return;
    map.panTo([driverLat, driverLng], { animate: true, duration: 0.35 });
  }, [driverLat, driverLng, followDriver, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !navigationMode || navigation || !destination) return;
    map.setView([destination.lat, destination.lng], 15);
  }, [destination, mapReady, navigation, navigationMode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !navigation || !navigationFollow) return;
    const position: [number, number] = [navigation.position.lat, navigation.position.lng];
    if (map.getZoom() !== navigation.zoom) {
      map.setView(position, navigation.zoom, { animate: true, duration: 0.5 });
    } else {
      map.panTo(position, { animate: true, duration: 0.5 });
    }
    if (navigation.heading !== null && Number.isFinite(navigation.heading)) {
      map.setHeading(navigation.heading, { ease: 0.22, deadzone: 2 });
    }
    const icon = driverMarkerRef.current?.getElement();
    icon?.style.setProperty("--moto-heading", "0deg");
  }, [mapReady, navigation, navigationFollow]);

  return (
    <div
      ref={elementRef}
      className={`real-map ${onPick ? "is-picking" : ""} ${navigation ? "is-navigating" : ""}`}
      aria-label={onPick ? "Mapa para selecionar um endereço" : "Mapa OpenStreetMap da corrida"}
    />
  );
}
