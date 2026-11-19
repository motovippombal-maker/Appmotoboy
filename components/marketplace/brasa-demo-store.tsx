"use client";

import { BRASA_SHOWCASE_CATALOG } from "@/lib/marketplace/brasa-showcase";
import { StoreSimulation } from "./store-simulation";

export function BrasaDemoStore() {
  return <StoreSimulation catalog={BRASA_SHOWCASE_CATALOG} mode="demo" />;
}
