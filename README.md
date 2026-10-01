# MotoPombal

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
- Cloudflare Workers/Sites e Vercel.

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
npx tsc --noEmit
npm run build
npm run build:vercel
npm run test:production
```

O caminho principal de publicação é Next.js nativo na Vercel: `npm run build:vercel` valida esse build e `vercel.json` o seleciona na plataforma. `npm run build` mantém Vinext/Cloudflare como caminho secundário de desenvolvimento e validação; não há deploy Cloudflare homologado nesta etapa. Execute `test:production` após os builds, pois ele verifica os bundles gerados. Para configuração e futura publicação deliberada, siga [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). Nenhum comando de deploy faz parte desta etapa.

## Banco de dados

As migrations incrementais estão em `supabase/migrations`. Antes de uma aplicação autorizada, confira o histórico real do projeto Supabase e preserve a ordem crescente: a migration financeira da Etapa 7 (`20260929100000`) antecede a migration de segurança da Etapa 8 (`20260929110000`). Nenhuma das duas foi aplicada ao banco real nesta etapa. Nunca reaplique cegamente conteúdo que o banco já recebeu.

Principais etapas:

1. schema inicial, autenticação, corridas e RLS;
2. aceite atômico;
3. finalização, GPS e tarifas administráveis;
4. financeiro, histórico, avaliações e notificações;
5. hardening de produção e fila Push;
6. tarifas por região/bairro.

## Tarifa atual e área de atendimento

A cobrança regional é resolvida no backend pelas coordenadas de origem e destino:

- tarifa padrão da cidade: R$ 5,00;
- Pombalzinho: R$ 7,00;
- Vila Operária: R$ 7,00;
- cobrança por minuto: R$ 0,00.

Os valores ficam no banco e podem ser alterados no painel administrativo. Distância e duração continuam sendo calculadas e registradas, mas não modificam a cobrança regional atual. A cotação recebe uma assinatura temporária do backend; se uma tarifa ou regra mudar antes da confirmação, a corrida não é criada até o passageiro confirmar a nova cotação.

### Configuração geográfica obrigatória

O repositório não contém um limite geográfico oficial de Ribeira do Pombal. Por segurança, a migration da ETAPA 3 cria `service_areas`, mas não insere coordenadas. Antes da produção, um administrador do banco deve cadastrar o limite oficial como GeoJSON `Polygon` ou `MultiPolygon`, usando posições na ordem `[longitude, latitude]`.

As regiões de tarifa especial usam o mesmo formato no campo `fare_regions.boundary`. Uma região especial ativa sem polígono não é aplicada por nome de endereço; dentro da área atendida, a tarifa padrão é usada. Em sobreposições, vence a maior `priority`; empates são resolvidos por nome e depois por ID em ordem crescente. Fora de uma área ativa que permita origem ou destino, o backend bloqueia a cotação com uma resposta controlada.

Polígonos fictícios existem somente nos testes automatizados. Nenhuma coordenada oficial foi presumida pelo projeto.

## GPS, mapa e endereços

As coordenadas obtidas pelo GPS ou escolhidas manualmente no mapa são a fonte da posição da corrida. A geocodificação reversa acrescenta somente a descrição do endereço e nunca substitui o ponto original.

A busca de endereços passa por uma camada de provedores e é executada somente quando a pessoa toca no botão de busca ou pressiona Enter. Atualmente são consultados Photon e Nominatim público de forma independente; não existe autocomplete contínuo configurado. Se um provedor falhar, resultados válidos do outro continuam disponíveis. Para autocomplete futuro será necessário configurar um provedor próprio que permita esse tipo de uso e suas credenciais reais.

O GPS usado pelo aplicativo funciona enquanto a página está aberta e autorizada pelo navegador. Localização contínua com o aplicativo fechado ou em segundo plano permanece pendente de homologação em PWA/aplicativo nativo e não é prometida por esta implementação.

## Produção

Consulte `MOTO_VIP_CHECKLIST_PRODUCAO.md` antes da abertura ao público. O projeto ainda exige configurações externas como domínio/HTTPS, SMTP, VAPID, provedor Pix, rotação de credenciais administrativas e homologação física em celulares.

Não declare o aplicativo pronto para operação comercial enquanto houver bloqueios críticos no checklist.
