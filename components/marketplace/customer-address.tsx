"use client";

import Link from "next/link";
import { MapPin, Search } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { marketFetch, marketMessage } from "@/lib/marketplace/customer-client";
import type { MarketPoint } from "@/lib/marketplace/customer-contract";
import { useMarketCustomer } from "./customer-shell";

type AddressResult = MarketPoint & { approximate?: boolean };

export function MarketAddress() {
  const { account, address, setAddress } = useMarketCustomer();
  const [text, setText] = useState("");
  const [results, setResults] = useState<AddressResult[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const request = useRef<AbortController | null>(null);
  const inputId = useId();
  useEffect(() => () => request.current?.abort(), []);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    if (!account.id || text.trim().length < 3 || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setError(""); setResults([]); setBusy(true);
    try {
      const data = await marketFetch<{ results: AddressResult[] }>(`/api/maps/search?q=${encodeURIComponent(text.trim())}`, { userId: account.id, signal: controller.signal });
      if (controller.signal.aborted) return;
      setResults(data.results);
      if (!data.results.length) setError("Nenhum endereço encontrado. Tente incluir o bairro e a cidade.");
    } catch (error) { if (!controller.signal.aborted) setError(marketMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function choose(result: AddressResult) {
    if (!account.id || busy) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setBusy(true); setError("");
    try {
      const point = { address: result.address.slice(0, 200), lat: result.lat, lng: result.lng };
      const { serviceAreas } = await marketFetch<{ serviceAreas: { id: string }[] }>("/api/marketplace/address", {
        userId: account.id, method: "POST", body: point, signal: controller.signal,
      });
      if (!controller.signal.aborted) {
        setAddress({ point, areaIds: serviceAreas.map(({ id }) => id) });
        setResults([]);
        setEditing(false);
      }
    } catch (error) { if (!controller.signal.aborted) setError(marketMessage(error)); }
    finally { if (!controller.signal.aborted) setBusy(false); }
  }
  if (account.loading) return <p role="status">Verificando sua sessão…</p>;
  if (!account.id) return <aside className="market-panel market-address"><MapPin size={18} /><span>Consulte as lojas e <Link href="/">entre na sua conta</Link> para definir o endereço e comprar.</span></aside>;
  return <section className="market-panel market-address" aria-label="Endereço de entrega">
    {address && !editing ? <div className="market-row"><MapPin size={19} /><div><small>Entregar em</small><strong>{address.point.address}</strong></div><button type="button" className="market-secondary" onClick={() => setEditing(true)}>Alterar</button></div> : <>
      <form className="market-address-form" onSubmit={search}>
        <label htmlFor={inputId}>Endereço de entrega</label>
        <div className="market-row"><input id={inputId} value={text} placeholder="Rua, número e bairro" maxLength={160} onChange={(event) => {
          request.current?.abort();
          setText(event.target.value); setError(""); setResults([]); setBusy(false);
        }} /><button type="submit" className="market-primary" disabled={busy || text.trim().length < 3}><Search size={17} /> Buscar</button></div>
      </form>
      {!!results.length && <ul className="market-address-results">{results.map((result) => <li key={`${result.lat}:${result.lng}:${result.address}`}>
        <button type="button" disabled={busy} onClick={() => void choose(result)}>{result.address}{result.approximate ? " (aproximado)" : ""}</button></li>)}</ul>}
      {busy && <small role="status">Verificando endereço…</small>}
      {error && <p className="market-error" role="alert">{error}</p>}
      {address && <button className="market-secondary" type="button" onClick={() => { request.current?.abort(); setBusy(false); setEditing(false); }}>Manter endereço atual</button>}
    </>}
  </section>;
}
