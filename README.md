# Moto VIP

Plataforma de mototáxi digital para Ribeira do Pombal/BA. O projeto reúne os fluxos de passageiro, motorista e administração com Supabase, localização, mapa, corridas em tempo real e tarifas administráveis por região.

## Funcionalidades

- autenticação real com perfis de passageiro, motorista e administrador;
- aprovação e cadastro de motorista/veículo;
- disponibilidade Online/Offline e localização controlada;
- Leaflet + OpenStreetMap e rotas OSRM;
- solicitação, oferta, aceite atômico e acompanhamento de corridas;
- início, chegada, finalização, cancelamento, histórico e avaliações;
- tarifa protegida no backend por região/bairro;
- tarifa padrão da cidade e regiões especiais administráveis;
- estrutura de Pix, notificações e financeiro;
- PWA instalável, atualização controlada e fallback offline seguro;
- políticas RLS e migrations incrementais do Supabase.

## Tecnologias

- React 19 e TypeScript;
- Next.js/Vinext;
- Supabase Auth, Postgres, RLS e Realtime;
- Leaflet, OpenStreetMap, Nominatim e OSRM;
- Web Push/VAPID;
- Cloudflare Workers/Sites.

## Requisitos

- Node.js `>=22.13.0`;
- projeto Supabase;
- npm.

## Configuração

Copie `.env.example` para `.env.local` e configure somente no ambiente local/servidor:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
ROUTING_BASE_URL=https://router.project-osrm.org
NEXT_PUBLIC_SITE_URL=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=
PUSH_DISPATCH_SECRET=
PIX_PROVIDER=
```

Nunca coloque `SUPABASE_SECRET_KEY`, chave privada VAPID ou credenciais financeiras no navegador ou no repositório.

## Instalação e desenvolvimento

```bash
npm install
npm run dev
```

O ambiente de desenvolvimento abre normalmente em `http://localhost:5173`.

## Verificações

```bash
npm run lint
npm run build
```

## Banco de dados

As migrations incrementais estão em `supabase/migrations`. Aplique-as em ordem crescente no projeto Supabase. Elas não devem ser reaplicadas em um banco que já tenha recebido o mesmo conteúdo manualmente.

Principais etapas:

1. schema inicial, autenticação, corridas e RLS;
2. aceite atômico;
3. finalização, GPS e tarifas administráveis;
4. financeiro, histórico, avaliações e notificações;
5. hardening de produção e fila Push;
6. tarifas por região/bairro.

## Tarifa atual

A cobrança utiliza a região identificada no destino:

- tarifa padrão da cidade: R$ 5,00;
- Pombalzinho: R$ 7,00;
- Vila Operária: R$ 7,00;
- cobrança por minuto: R$ 0,00.

Os valores ficam no banco e podem ser alterados no painel administrativo. Distância e duração continuam sendo calculadas e registradas, mas não modificam a cobrança regional atual. O preço é recalculado e protegido pelo backend.

## Produção

Consulte `MOTO_VIP_CHECKLIST_PRODUCAO.md` antes da abertura ao público. O projeto ainda exige configurações externas como domínio/HTTPS, SMTP, VAPID, provedor Pix, rotação de credenciais administrativas e homologação física em celulares.

Não declare o aplicativo pronto para operação comercial enquanto houver bloqueios críticos no checklist.
