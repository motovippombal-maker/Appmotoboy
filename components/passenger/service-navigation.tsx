"use client";

import Link from "next/link";
import { Bike, Navigation, ShoppingCart } from "lucide-react";

type PassengerService = "transport" | "delivery" | "shopping";

const services = [
  { id: "transport", label: "Transporte", href: "/", Icon: Bike },
  { id: "delivery", label: "Entrega", href: "/?servico=entrega", Icon: Navigation },
  { id: "shopping", label: "Compras", href: "/compras", Icon: ShoppingCart },
] as const;

export function ServiceNavigation({
  current,
  onTransport,
  onDelivery,
  disabled = false,
}: {
  current?: PassengerService;
  onTransport?: () => void;
  onDelivery?: () => void;
  disabled?: boolean;
}) {
  return (
    <nav className="market-entry" aria-label="Serviços MotoPombal">
      {services.map(({ id, label, href, Icon }) => {
        const action = id === "transport" ? onTransport : id === "delivery" ? onDelivery : undefined;
        const content = <><Icon size={16} aria-hidden="true" /><span>{label}</span></>;
        return action ? (
          <button key={id} className="market-entry-item" type="button" aria-pressed={current === id} disabled={disabled} onClick={action}>
            {content}
          </button>
        ) : (
          <Link key={id} className="market-entry-item" href={href} aria-current={current === id ? "page" : undefined}>
            {content}
          </Link>
        );
      })}
    </nav>
  );
}
