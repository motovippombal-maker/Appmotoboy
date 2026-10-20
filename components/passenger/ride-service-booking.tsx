"use client";

import { useId } from "react";
import { Bike, Check, Package, Pill, ShoppingCart, Utensils } from "lucide-react";
import {
  getRideService,
  RIDE_SERVICE_OPTIONS,
  type RideServiceDetails,
  type RideServiceType,
} from "@/lib/ride-service";

const SERVICE_ICONS = {
  passenger: Bike,
  delivery: Package,
  food: Utensils,
  market: ShoppingCart,
  pharmacy: Pill,
};

const DELIVERY_COPY = {
  delivery: {
    heading: "O que vamos entregar?",
    descriptionLabel: "Descrição da encomenda",
    descriptionPlaceholder: "Ex.: envelope com documentos, pacote pequeno…",
    help: "Descreva o item para o motorista organizar a retirada e a entrega.",
  },
  food: {
    heading: "Retirada de comida",
    descriptionLabel: "Restaurante e identificação do pedido",
    descriptionPlaceholder: "Ex.: pedido 125, em nome de Ana, no Restaurante Central",
    help: "Faça o pedido diretamente no restaurante e confirme que está pronto para retirada. O frete não inclui o valor da comida.",
  },
  market: {
    heading: "Retirada no mercado",
    descriptionLabel: "Mercado e identificação da compra",
    descriptionPlaceholder: "Ex.: compra em nome de Ana, 2 sacolas, Mercado Central",
    help: "Combine a compra com o mercado e deixe os produtos prontos para retirada. O frete não inclui o valor das compras.",
  },
  pharmacy: {
    heading: "Retirada na farmácia",
    descriptionLabel: "Farmácia e identificação do pedido",
    descriptionPlaceholder: "Ex.: pedido 125 em nome de Ana, Farmácia Central",
    help: "Combine o pedido com a farmácia e confirme que está pronto para retirada. O frete não inclui o valor dos produtos.",
  },
};

export function RideServicePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: RideServiceType;
  onChange: (value: RideServiceType) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="ride-service-picker" disabled={disabled}>
      <legend>O que você precisa?</legend>
      <div className="ride-service-options">
        {RIDE_SERVICE_OPTIONS.map((service) => {
          const Icon = SERVICE_ICONS[service.id];
          const selected = value === service.id;
          return (
            <button
              key={service.id}
              type="button"
              className={`ride-service-option${selected ? " is-selected" : ""}`}
              aria-pressed={selected}
              onClick={() => onChange(service.id)}
            >
              <span className="ride-service-option-icon"><Icon aria-hidden="true" /></span>
              <span className="ride-service-option-copy"><b>{service.label}</b><small>{service.description}</small></span>
              {selected && <Check className="ride-service-option-check" aria-hidden="true" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

export function DeliveryDetailsForm({
  serviceType,
  value,
  onChange,
  disabled = false,
}: {
  serviceType: RideServiceType;
  value: RideServiceDetails;
  onChange: (value: RideServiceDetails) => void;
  disabled?: boolean;
}) {
  const id = useId();
  if (serviceType === "passenger") return null;
  const copy = DELIVERY_COPY[serviceType];
  const update = (field: keyof RideServiceDetails, content: string) => onChange({ ...value, [field]: content });

  return (
    <fieldset className="ride-delivery-form" disabled={disabled}>
      <legend>{copy.heading}</legend>
      <p id={`${id}-help`} className="ride-delivery-help">{copy.help}</p>
      <label htmlFor={`${id}-description`}>
        {copy.descriptionLabel} <span className="ride-field-required">(obrigatório)</span>
      </label>
      <textarea
        id={`${id}-description`}
        name="deliveryDescription"
        value={value.description || ""}
        onChange={(event) => update("description", event.target.value)}
        placeholder={copy.descriptionPlaceholder}
        aria-describedby={`${id}-help`}
        rows={2}
        minLength={3}
        maxLength={500}
        required
      />
      <div className="ride-delivery-recipient">
        <div>
          <label htmlFor={`${id}-recipient-name`}>Quem recebe? <span className="ride-field-required">(obrigatório)</span></label>
          <input
            id={`${id}-recipient-name`}
            name="recipientName"
            autoComplete="off"
            value={value.recipientName || ""}
            onChange={(event) => update("recipientName", event.target.value)}
            placeholder="Nome do destinatário"
            minLength={2}
            maxLength={100}
            required
          />
        </div>
        <div>
          <label htmlFor={`${id}-recipient-phone`}>Telefone de quem recebe <span className="ride-field-required">(obrigatório)</span></label>
          <input
            id={`${id}-recipient-phone`}
            name="recipientPhone"
            type="tel"
            inputMode="tel"
            autoComplete="off"
            value={value.recipientPhone || ""}
            onChange={(event) => update("recipientPhone", event.target.value)}
            placeholder="(75) 99999-9999"
            maxLength={30}
            required
          />
        </div>
      </div>
      <details className="ride-delivery-extra">
        <summary>Instruções para o motorista <span>(opcional)</span></summary>
        <label htmlFor={`${id}-pickup-notes`}>Na retirada</label>
        <textarea
          id={`${id}-pickup-notes`}
          name="pickupNotes"
          value={value.pickupNotes || ""}
          onChange={(event) => update("pickupNotes", event.target.value)}
          placeholder="Ex.: buscar no balcão, falar com João"
          rows={2}
          maxLength={300}
        />
        <label htmlFor={`${id}-dropoff-notes`}>Na entrega</label>
        <textarea
          id={`${id}-dropoff-notes`}
          name="dropoffNotes"
          value={value.dropoffNotes || ""}
          onChange={(event) => update("dropoffNotes", event.target.value)}
          placeholder="Ex.: casa 2, chamar na portaria"
          rows={2}
          maxLength={300}
        />
      </details>
    </fieldset>
  );
}

function telephoneHref(phone: string) {
  const trimmed = phone.trim();
  if (!/^\+?[\d\s().-]+$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `tel:${trimmed.startsWith("+") ? "+" : ""}${digits}`;
}

export function RideServiceSummary({
  ride,
  compact = false,
}: {
  ride: {
    service_type?: RideServiceType | null;
    service_details?: RideServiceDetails | null;
  };
  compact?: boolean;
}) {
  const service = getRideService(ride.service_type);
  if (service.id === "passenger" && compact) return null;
  const Icon = SERVICE_ICONS[service.id];
  const details = service.id === "passenger" ? null : ride.service_details;
  const phoneHref = details?.recipientPhone ? telephoneHref(details.recipientPhone) : null;

  return (
    <section className={`ride-service-summary${compact ? " is-compact" : ""}`} aria-label={`Serviço: ${service.label}`}>
      <div className="ride-service-summary-heading"><Icon aria-hidden="true" /><b>{service.label}</b></div>
      {details && (
        <dl>
          {details.description && <div><dt>Pedido</dt><dd>{details.description}</dd></div>}
          {details.recipientName && <div><dt>Quem recebe</dt><dd>{details.recipientName}</dd></div>}
          {details.recipientPhone && <div><dt>Telefone</dt><dd>{phoneHref ? <a href={phoneHref}>{details.recipientPhone}</a> : details.recipientPhone}</dd></div>}
          {details.pickupNotes && <div><dt>Na retirada</dt><dd>{details.pickupNotes}</dd></div>}
          {details.dropoffNotes && <div><dt>Na entrega</dt><dd>{details.dropoffNotes}</dd></div>}
        </dl>
      )}
    </section>
  );
}
