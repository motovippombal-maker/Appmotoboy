# MOTOPOMBAL — CHECKLIST PARA ABERTURA AO PÚBLICO

Data da revisão: 29/09/2026

Este documento separa implementação técnica, teste e homologação real. O aplicativo **não deve ser liberado comercialmente** enquanto houver item crítico bloqueado ou pendente de homologação.

## Portão de publicação — Etapa 9

Os checks técnicos locais não equivalem a uma liberação. `[x]` indica somente validação no repositório/ambiente isolado; `[ ]` exige configuração ou homologação externa:

- [ ] Definir e cadastrar a origem HTTPS final em `NEXT_PUBLIC_SITE_URL` e nos redirects do Supabase Auth.
- [ ] Conferir o histórico do banco, realizar backup recuperável e aplicar, com autorização separada, a migration financeira da Etapa 7 **antes** da migration de segurança da Etapa 8; validar sem reaplicação cega.
- [ ] Verificar compatibilidade e concorrência em PostgreSQL real multi-conexão; os testes isolados atuais usam principalmente PGlite.
- [ ] Confirmar a configuração de `SUPABASE_SECRET_KEY` somente no servidor; ela também deriva a assinatura HMAC das cotações. Planejar a rotação sem invalidar cotações pendentes inadvertidamente.
- [ ] Comprovar a rotação/revogação da chave administrativa antiga e revisar os Advisors de segurança e desempenho do Supabase.
- [ ] Configurar VAPID e despachante autenticado de Push, ou manter Push indisponível; testar expiração, logout e troca de usuário em aparelhos reais.
- [ ] Homologar Pix com provedor real, ou mantê-lo explicitamente indisponível, sem aprovação fictícia.
- [x] Aprovar lint, TypeScript, ambos os builds, regressões 2–8 e 25 testes da Etapa 9 no artefato local.
- [x] Executar as 13 migrations desde zero, em ordem, em banco PGlite isolado; isto não comprova a aplicação no Supabase real.
- [ ] Validar manifest, ícones, instalação, atualização e offline em Android e iOS reais por HTTPS.
- [ ] Concluir fluxo autenticado passageiro/motorista, GPS, Push e rede instável em dois celulares reais. Não presumir tracking contínuo em segundo plano.
- [ ] Registrar o deployment anterior, testar restauração do backup e aprovar o plano de rollback do frontend e de recuperação do banco.

O caminho principal escolhido é **Next.js/Vercel** (`npm run build:vercel`); Vinext/Cloudflare (`npm run build`) permanece secundário. Consulte [VERCEL_DEPLOYMENT.md](VERCEL_DEPLOYMENT.md) para escopos das variáveis e plano de recuperação. Não fazer deploy, mudar DNS ou aplicar migrations reais como parte desta Etapa 9.

## Situação por recurso

| Recurso | Implementado | Testado | Homologado | Pendente |
|---|---|---|---|---|
| Autenticação e sessão | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Perfis e separação passageiro/motorista | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| PWA: manifest, ícones e modo standalone | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Service Worker e atualização controlada | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Tela neutra para falta de conexão | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| GPS e Online/Offline | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Mapa, rota e cálculo da corrida | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Corrida em tempo real e aceite atômico | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Histórico, avaliações e financeiro | PRONTO | PRONTO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |
| Migration de hardening da Etapa 6 | PRONTO | PRONTO | PRONTO | PRONTO |
| Push Web/PWA | PRONTO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO |
| Pix real | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO |
| Tarifa comercial por região | PRONTO | PRONTO | PRONTO | PRONTO |
| Comissão/taxa da plataforma | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO |
| SMTP transacional | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO |
| Domínio, HTTPS e URLs de redirecionamento | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO |
| Rotação da chave administrativa exposta anteriormente | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO | BLOQUEADO POR CREDENCIAL/CONFIGURAÇÃO |
| Teste ponta a ponta com dois celulares | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO | PENDENTE DE HOMOLOGAÇÃO |

## Bloqueios críticos antes da abertura

- Definir a regra de comissão/taxa da plataforma, caso ela seja adotada.
- Escolher e homologar um provedor Pix real. Até isso ocorrer, o sistema deve continuar informando **Provedor Pix não configurado** e nunca confirmar um Pix fictício.
- Criar as chaves VAPID, configurar o remetente e agendar uma chamada autenticada ao despachante de Push.
- Configurar domínio público com HTTPS e ajustar a URL principal e as URLs de redirecionamento do Supabase Auth.
- Configurar SMTP próprio para e-mails de cadastro e recuperação de senha.
- Rotacionar a chave administrativa do Supabase que foi compartilhada durante o desenvolvimento, atualizar somente o ambiente do servidor e revogar a chave antiga.
- Executar a bateria ponta a ponta em dois celulares reais, preferencialmente Android e iOS, incluindo internet móvel ruim, troca de rede, tela bloqueada e retomada do aplicativo.

## Variáveis de ambiente

Somente os nomes são documentados aqui. Valores secretos nunca devem ser enviados ao navegador nem adicionados ao repositório.

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`
- `ROUTING_BASE_URL`
- `NEXT_PUBLIC_SITE_URL`
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_DISPATCH_SECRET`
- `PIX_PROVIDER`

As credenciais específicas do provedor Pix devem ser adicionadas apenas depois que o provedor for escolhido, usando nomes definidos pela documentação oficial dele e mantendo todos os segredos no servidor.

## Checklist técnico

- [x] Manifest com nome, escopo, cores, orientação e modo standalone.
- [x] Ícones 192×192, 512×512, maskable e Apple Touch Icon.
- [x] Service Worker sem cache de API, sessão ou dados privados.
- [x] Atualização do PWA controlada pelo usuário.
- [x] Fallback offline neutro.
- [x] Estado visual de offline, reconexão e sincronização após retorno da rede.
- [x] Cabeçalhos básicos de segurança e política de geolocalização.
- [x] Rate limiting nos endpoints críticos adicionados nesta etapa.
- [x] Validação de payload e limite de upload do cadastro do motorista.
- [x] Verificação do bundle para ausência de segredos conhecidos.
- [x] Fila idempotente e políticas de segurança do Push preparadas em migration.
- [x] Aplicar e validar a migration da Etapa 6 no Supabase remoto.
- [ ] Revisar os Security e Performance Advisors do Supabase após a migration.
- [ ] Criar VAPID, configurar o despachante e testar cada evento Push.
- [x] Configurar e homologar a tarifa comercial por região.
- [ ] Definir a comissão/taxa real da plataforma.
- [ ] Escolher e homologar o provedor Pix e seu webhook idempotente.
- [ ] Configurar SMTP, domínio, HTTPS e redirects.
- [ ] Rotacionar a chave administrativa anteriormente compartilhada.
- [ ] Testar instalação, GPS e notificações em Android real.
- [ ] Testar instalação, GPS e notificações em iOS real.
- [ ] Testar corrida completa simultaneamente em dois celulares.
- [ ] Testar perda e retorno de internet em todos os estados da corrida.
- [ ] Fazer auditoria externa final de RLS, endpoints, Storage e financeiro.

## Roteiro de homologação em dois celulares

1. Instalar o PWA nos dois aparelhos pelo domínio HTTPS definitivo.
2. No aparelho A, entrar como passageiro; no aparelho B, entrar como motorista aprovado.
3. Permitir localização somente quando o recurso for solicitado e permitir notificações no contexto apropriado.
4. Colocar o motorista Online, confirmar localização recente e solicitar uma corrida pelo passageiro.
5. Validar oferta, aceite, aproximação, chegada, início, acompanhamento e finalização sem atualizar a página.
6. Confirmar distância, duração, preço final, histórico, avaliação e financeiro.
7. Repetir com internet móvel instável, troca entre Wi‑Fi e dados, suspensão e retomada do aplicativo.
8. Confirmar que Pix só muda para pago após webhook real e validado do provedor.
9. Confirmar recebimento de Push com o aplicativo em primeiro plano, segundo plano e fechado, respeitando as limitações do sistema operacional.

## Limitações conhecidas de plataforma

- Navegadores móveis podem suspender JavaScript, GPS e conexões Realtime quando o PWA fica em segundo plano ou a tela é bloqueada. O aplicativo ressincroniza ao voltar ao primeiro plano, mas rastreamento contínuo em segundo plano não deve ser prometido como garantido em PWA.
- Push no iOS exige instalação do PWA na tela inicial e permissão explícita do usuário.
- A precisão e a frequência do GPS dependem do aparelho, sinal, economia de bateria e permissões do sistema.

## Critério de liberação

A abertura ao público só deve ocorrer quando todos os itens críticos estiverem como **PRONTO**, os fluxos físicos estiverem homologados em celulares reais e não houver segredo administrativo antigo ainda válido.
