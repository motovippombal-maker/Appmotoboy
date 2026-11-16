"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ShoppingBag, ReceiptText } from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase/client";
import type { MarketCart } from "@/lib/marketplace/cart";
import type { MarketPoint } from "@/lib/marketplace/customer-contract";
import { createMarketCheckoutAttempts, isPurchasedCart, nextMarketAccountScope, type MarketAccountScope } from "@/lib/marketplace/checkout-attempt";

type MarketAccount = { id: string; loading: false } | { id: null; loading: boolean };
type MarketAddressValue = { point: MarketPoint; areaIds: string[] };
const MarketContext = createContext<{
  account: MarketAccount;
  cart: MarketCart | null;
  setCart: (value: MarketCart | null) => void;
  address: MarketAddressValue | null;
  setAddress: (value: MarketAddressValue | null) => void;
  isCurrentSession: () => boolean;
  pendingCheckoutKey: () => string | null;
  rememberCheckout: (key: string, cart: MarketCart) => boolean;
  resolveCheckout: (key: string, cart?: MarketCart) => boolean;
} | null>(null);
const tabStorage = () => { try { return window.sessionStorage; } catch { return undefined; } };

export function useMarketCustomer() {
  const context = useContext(MarketContext);
  if (!context) throw new Error("Área Compras não inicializada.");
  return context;
}

export function MarketCustomerShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? "";
  const demo = pathname.startsWith("/compras/demonstracao/");
  const storefront = demo || pathname.startsWith("/compras/lojas/");
  const [session, setSession] = useState<MarketAccountScope & { loading: boolean }>({ loading: true, id: null, generation: 0 });
  const scope = useRef<MarketAccountScope>({ id: null, generation: 0 });
  const [attempts] = useState(createMarketCheckoutAttempts);
  const [identityCart, setIdentityCart] = useState<{ generation: number; value: MarketCart | null }>({ generation: 0, value: null });
  const [identityAddress, setIdentityAddress] = useState<{ generation: number; value: MarketAddressValue | null }>({ generation: 0, value: null });
  const account: MarketAccount = session.id ? { id: session.id, loading: false } : { id: null, loading: session.loading };
  const cart = identityCart.generation === session.generation ? identityCart.value : null;
  const address = identityAddress.generation === session.generation ? identityAddress.value : null;
  const isCurrentSession = useCallback(() => scope.current.generation === session.generation, [session.generation]);
  const pendingCheckoutKey = useCallback(() => isCurrentSession() && session.id ? attempts.read(session.id, tabStorage()) : null, [attempts, isCurrentSession, session.id]);
  useEffect(() => {
    if (demo) return;
    try {
      const supabase = getSupabaseBrowserClient();
      const { data } = supabase.auth.onAuthStateChange((_event, next) => {
        scope.current = nextMarketAccountScope(scope.current, next?.user.id ?? null);
        setSession({ ...scope.current, loading: false });
      });
      return () => data.subscription.unsubscribe();
    } catch {
      const timer = window.setTimeout(() => setSession((current) => ({ ...current, loading: false })), 0);
      return () => window.clearTimeout(timer);
    }
  }, [demo]);
  return (
    <MarketContext.Provider value={{
      account, cart, setCart: (value) => { if (isCurrentSession()) setIdentityCart({ generation: session.generation, value }); },
      address, setAddress: (value) => { if (isCurrentSession()) setIdentityAddress({ generation: session.generation, value }); },
      isCurrentSession, pendingCheckoutKey,
      rememberCheckout: (key, value) => {
        if (!session.id || !isCurrentSession()) return false;
        attempts.remember(session.id, key, value, tabStorage());
        return true;
      },
      resolveCheckout: (key, submittedCart) => {
        if (!session.id || !isCurrentSession()) return false;
        const resolved = attempts.resolve(session.id, key, tabStorage(), submittedCart);
        if (!resolved) return false;
        if (resolved.cart) setIdentityCart((current) => current.generation === session.generation && isPurchasedCart(current.value, resolved.cart) ? { ...current, value: null } : current);
        return true;
      },
    }}>
      <div className={`market-shell${storefront ? " market-shell-storefront" : ""}`}>
        <header className="market-top">
          <Link href="/" aria-label="Voltar ao MotoPombal" prefetch={demo ? false : undefined}><ArrowLeft size={19} /></Link>
          <Link href="/compras" className="market-wordmark" prefetch={demo ? false : undefined}>MotoPombal <span>Compras</span></Link>
          {demo ? <span className="market-top-demo">Demonstração</span> : <nav aria-label="Compras">
            {cart && <Link href={`/compras/lojas/${cart.slug}#carrinho`} aria-label={`Carrinho com ${cart.entries.length} seleções`}><ShoppingBag size={19} /> <b>{cart.entries.length}</b></Link>}
            <Link href="/compras/pedidos" aria-label="Meus pedidos"><ReceiptText size={19} /></Link>
          </nav>}
        </header>
        <main className="market-main" key={session.generation}>{children}</main>
      </div>
    </MarketContext.Provider>
  );
}
