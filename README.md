# MotoPombal

Plataforma de mototáxi e entregas para Ribeira do Pombal/BA. O projeto reúne os fluxos de cliente, motorista e administração com Supabase, localização, mapa, corridas e entregas em tempo real e tarifas administráveis por região.

## Funcionalidades

- autenticação real com perfis de passageiro, motorista e administrador;
- aprovação e cadastro de motorista/veículo;
- disponibilidade Online/Offline e localização controlada;
- Leaflet + OpenStreetMap e rotas OSRM;
- solicitação, oferta, aceite atômico e acompanhamento de corridas;
- escolha de serviço: passageiro, encomendas, comida, mercado e farmácia;
- retirada e entrega com descrição do pedido, destinatário e instruções para o motorista;
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
npm run test:auth
npm run test:tracking
npm run test:location
npm run test:offline
npm run test:services
npm run test:rides
npm run test:regressions
npx tsc --noEmit
npm run build
npm run build:vercel
npm run test:production
```

O caminho principal de publicação é Next.js nativo na Vercel: `npm run build:vercel` valida esse build e `vercel.json` o seleciona na plataforma. `npm run build` mantém Vinext/Cloudflare como caminho secundário de desenvolvimento e validação; não há deploy Cloudflare homologado nesta etapa. Execute `test:production` após os builds, pois ele verifica os bundles gerados. Para configuração e futura publicação deliberada, siga [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md). Nenhum comando de deploy faz parte desta etapa.

Sem as variáveis reais do Supabase, `build:vercel` interrompe corretamente na validação do ambiente. Para conferir apenas a compilação nesse caso, use `npx next build --experimental-build-mode compile` e depois `npx tsc --noEmit`. O modo `compile` não executa a prerenderização nem a checagem de tipos do App Router; esses comandos não substituem o build completo de publicação.

### Dependências verificadas em 20/10/2026

Next.js, React e as dependências vulneráveis com correções compatíveis foram atualizados. A auditoria `npm audit --omit=dev` retornou zero vulnerabilidades. A auditoria completa ainda registra 12 avisos nas ferramentas de desenvolvimento, nas cadeias de `braces` (ESLint/Vinext) e do `esbuild` antigo usado pelo Drizzle Kit. Essas cadeias ainda exigem atualização dos fornecedores; não foram aplicados downgrades forçados para silenciar o relatório. Repita a auditoria ao atualizar dependências.

## Banco de dados

As migrations incrementais estão em `supabase/migrations`. Antes de uma aplicação autorizada, confira o histórico real do projeto Supabase e preserve a ordem crescente: a migration financeira da Etapa 7 (`20260929100000`) antecede a migration de segurança da Etapa 8 (`20260929110000`). Nenhuma das duas foi aplicada ao banco real nesta etapa. Nunca reaplique cegamente conteúdo que o banco já recebeu.

### Atualização de integridade de 20/10/2026

A versão atual também exige as migrations `20261020130000_profile_phone_identity.sql` e `20261020131000_recover_unoffered_rides.sql`, após a migration dos serviços de entrega. A primeira protege a identidade por telefone, incluindo cadastros antigos, edição de contato e aliases de autenticação. O login utiliza uma RPC restrita ao servidor; aplique essa migration antes de publicar o backend atualizado. Se ela ainda não existir, o acesso por telefone retorna indisponibilidade controlada.

A migration de identidade interrompe a atualização caso encontre telefones duplicados ou conflito de titularidade com aliases existentes. Ela não apaga nem mescla contas e não reescreve telefones legados: a central deve conferir a titularidade desses casos antes de tentar novamente. A segunda migration recupera solicitações que ficaram sem a primeira oferta por mais de dois minutos e libera reservas de cupom de solicitações incompletas que precisem ser encerradas.

As transições também conferem a atribuição e o horário de aceite, evitando que uma ação atrasada do motorista anterior altere uma corrida redistribuída. As migrations são verificadas em banco isolado pelos testes; nenhuma atualização do Supabase real é executada pelo aplicativo ou pelos comandos de build.

Principais etapas:

1. schema inicial, autenticação, corridas e RLS;
2. aceite atômico;
3. finalização, GPS e tarifas administráveis;
4. financeiro, histórico, avaliações e notificações;
5. hardening de produção e fila Push;
6. tarifas por região/bairro.

## Tarifa atual e área de atendimento

### Corridas e entregas

Na tela inicial, escolha **Passageiro**, **Encomendas**, **Comida**, **Mercado** ou **Farmácia**. Entregas exigem local de retirada e de entrega, descrição do pedido, nome e telefone de quem recebe. As instruções de retirada e entrega são opcionais. Os pontos rápidos da cidade definem o local de retirada quando um serviço de entrega está selecionado; Casa, Trabalho e favoritos continuam definindo o destino.

Comida, mercado e farmácia atendem pedidos combinados diretamente com o estabelecimento e prontos para retirada. O valor mostrado no aplicativo é o transporte, calculado pela tarifa regional vigente, e não inclui os produtos. O motorista vê o serviço e os dados do pedido antes de aceitar, confirma a retirada e depois a entrega. Os dados também aparecem no acompanhamento, no histórico, na administração e no pacote de navegação offline.

Para habilitar essas solicitações no Supabase, aplique a migration incremental `supabase/migrations/20261020120000_ride_service_types.sql` após as migrations anteriores, seguindo o processo de atualização do seu ambiente. Ela preserva corridas existentes como `passenger`. A API mantém compatibilidade com solicitações de passageiros quando faltam apenas os campos de entrega; uma entrega será bloqueada com mensagem de ativação pendente, sem descartar os dados do pedido. Essa compatibilidade não dispensa a migration de identidade exigida pelo login. As migrations não são aplicadas automaticamente pelo aplicativo.

### Valores regionais

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
