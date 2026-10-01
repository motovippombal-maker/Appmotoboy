import type { AddressResult } from "@/hooks/use-moto-vip";

export type SavedPlace = {
  id: string;
  kind: "home" | "work" | "favorite";
  label: string;
  address: AddressResult;
};

const key = (userId: string) => `motopombal:passenger-places:${userId}`;

export function loadSavedPlaces(userId: string): SavedPlace[] {
  if (typeof window === "undefined" || !userId) return [];
  try {
    const data: unknown = JSON.parse(window.localStorage.getItem(key(userId)) || "[]");
    if (!Array.isArray(data)) return [];
    return data.filter((item): item is SavedPlace =>
      Boolean(item && typeof item === "object" &&
        typeof item.id === "string" &&
        ["home", "work", "favorite"].includes(item.kind) &&
        typeof item.label === "string" &&
        item.address && typeof item.address.address === "string" &&
        Number.isFinite(item.address.lat) && Number.isFinite(item.address.lng)),
    ).slice(0, 30);
  } catch {
    return [];
  }
}

export function persistSavedPlaces(userId: string, places: SavedPlace[]) {
  if (typeof window !== "undefined" && userId) {
    window.localStorage.setItem(key(userId), JSON.stringify(places.slice(0, 30)));
  }
}
