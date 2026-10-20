-- Tipos de serviço incrementais. Corridas existentes continuam como passageiro;
-- despacho, cobrança regional e transições mantêm as mesmas regras.
alter table public.rides
  add column if not exists service_type text not null default 'passenger',
  add column if not exists service_details jsonb not null default '{}'::jsonb;

alter table public.rides
  add constraint rides_service_type_valid
    check (service_type in ('passenger', 'delivery', 'food', 'market', 'pharmacy')),
  add constraint rides_service_details_valid check (
    coalesce(
      jsonb_typeof(service_details) = 'object'
      and (
        (service_type = 'passenger' and service_details = '{}'::jsonb)
        or (
          service_type <> 'passenger'
          and jsonb_typeof(service_details -> 'description') = 'string'
          and char_length(btrim(service_details ->> 'description')) between 3 and 500
          and jsonb_typeof(service_details -> 'recipientName') = 'string'
          and char_length(btrim(service_details ->> 'recipientName')) between 2 and 100
          and jsonb_typeof(service_details -> 'recipientPhone') = 'string'
          and (service_details ->> 'recipientPhone') ~ '^\+55(1[1-9]|[2-9][0-9])[1-9][0-9]{7,8}$'
          and (not (service_details ? 'pickupNotes') or (
            jsonb_typeof(service_details -> 'pickupNotes') = 'string'
            and char_length(service_details ->> 'pickupNotes') <= 300
          ))
          and (not (service_details ? 'dropoffNotes') or (
            jsonb_typeof(service_details -> 'dropoffNotes') = 'string'
            and char_length(service_details ->> 'dropoffNotes') <= 300
          ))
        )
      ), false
    )
  );

comment on column public.rides.service_type is
  'Serviço solicitado: passageiro, encomenda, comida, mercado ou farmácia. A tarifa corresponde apenas ao transporte.';
comment on column public.rides.service_details is
  'Descrição do volume, destinatário e instruções da entrega; vazio para passageiro. Não inclui pagamento de produtos.';
