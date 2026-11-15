# Marketplace: preparação local da publicação e da ativação

**Decisão desta revisão: envio ao GitHub pela branch de homologação, sem deploy.** A preparação e os testes foram locais. O responsável informou posteriormente que aplicou a `146000` com RLS e criou o registro de produção com `enabled = false`; o estado remoto do banco não foi verificado. O roteiro de produção abaixo exige uma decisão separada para publicar e ativar.

## Checkout e origem

| Item | Evidência desta revisão |
| --- | --- |
| Checkout inspecionado | `D:\Appmotoboy` |
| Estado inicial | `main`, HEAD `10a3255`, referência local `origin/main` também em `10a3255`. A referência local não prova o HEAD remoto atual. |
| Remoto inspecionado | `origin` com destino GitHub `motovippombal-maker/Appmotoboy`. A URL foi examinada sem credenciais. |
| Branch de entrega | `homologacao/marketplace-financeiro`, partindo de `10a3255`. O envio dessa branch foi autorizado separadamente; `main` fica fora do envio. |
| GitHub | O conector identificou a conta `carlosefa`, repositório público, branch padrão `main` e permissões de metadados de leitura/escrita sem administração. A consulta específica de permissão retornou 403 para a integração. Isso não comprova autenticação do Git CLI nem autorização para alterar regras ou webhooks. |
| Árvore de trabalho inicial | Alterações existentes de Compras, homologação SQL, GPS e notificações, inclusive arquivos ainda não rastreados. Preservar a árvore; não tratar todo o diff como alteração somente financeira desta revisão. |
| Arquivos de publicação | `vercel.json`, `next.config.ts`, `package.json`, lockfile, `.gitignore` e `.vercelignore` foram inspecionados. `git check-ignore` confirmou exclusão de `.env.local`, `.vercel/project.json`, `supabase/.temp`, dependências, saídas e `work/`. A pasta local `.codex-attachments/` apareceu não rastreada no inventário inicial e posteriormente recebeu exclusão em `.gitignore` e `.vercelignore`; anexos não fazem parte da entrega. |

O escopo candidato combina o código de Compras e as correções locais da auditoria anterior ainda fora do HEAD com a blindagem financeira e a documentação desta missão. Antes de qualquer commit, comparar o índice com o estado inicial e separar instruções, anexos, logs, configurações locais e resultados reais. Como o repositório é público, enviar a branch já tornaria seu conteúdo público mesmo sem deploy.

## Configuração e evidências

- O preset em `vercel.json` é Next.js, com `npm ci` e `npm run build:vercel`. O script chama a checagem de ambiente, prepara a revisão do Service Worker e executa `next build`. Diretório de saída automático da Vercel e Node compatível com o mínimo declarado de 22.13. Vinext/Cloudflare permanece um alvo local e não substitui essa validação.
- `node scripts/check-vercel-env.mjs` informou ausência de `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`. A configuração local tinha apenas o exemplo e não o arquivo `.env.local`. **Build completo com o ambiente Vercel: bloqueado neste diagnóstico.** Compilação parcial ou teste com ambiente local isolado deve ser identificado separadamente, sem substituir o build exigido.
- O parser do modo de teste passou em sete verificações locais sem rede: Preview sintático válido, modo ausente, modo `live`, produção explícita, URLs diferentes, URL não HTTPS e UUID inválido. Isso verifica o contrato de configuração; não comprova o vínculo com Supabase nem a atestação em ambiente publicado.
- Não foi encontrada CLI Vercel no PATH ou nas dependências instaladas, arquivo local de vínculo com o projeto, nem as variáveis `VERCEL_TOKEN`, `VERCEL_ORG_ID` e `VERCEL_PROJECT_ID` no ambiente de execução. Nenhum login foi tentado. A ausência local não prova inexistência de projeto, domínio ou credencial no painel.
- Não há `.github/workflows/` no checkout inspecionado, e o conector retornou 404 para o caminho na `main`. As integrações instaladas pelo proprietário, os webhooks, as regras da branch, a produção configurada na Vercel e os parâmetros efetivos do projeto não foram confirmados. [A integração Git da Vercel pode iniciar deploys a partir de pushes](https://vercel.com/docs/environment-variables). A ausência de workflow GitHub não elimina esse risco.
- O histórico do GitHub mostrou checks de dois projetos Vercel. O `vercel.json` desativa [deploy automático via Git](https://vercel.com/docs/project-configuration/git-configuration#gitdeploymentenabled) somente na branch `homologacao/marketplace-financeiro`. A regra vale para integrações Vercel que leem este arquivo; não configura webhooks externos ou deploys manuais.
- `vercel.json` não declara `crons`; os despachantes do app são endpoints internos **POST** autenticados. [Cron nativo da Vercel aciona GET no deploy de produção](https://vercel.com/docs/schedules/cron-jobs). Para este preview, manter os despachantes desligados até validar um agendador isolado que suporte POST em URLs protegidas. Nunca redirecionar cron ou webhook de produção para habilitar o teste.
- Não se confirmou Supabase completo de homologação nem projeto vinculado ao checkout. A CLI Supabase estar disponível não autoriza consultar ou modificar ambiente remoto. A [auditoria anterior](AUDITORIA_MARKETPLACE.md) e a [homologação SQL](HOMOLOGACAO_SUPABASE.md) documentam testes locais e seus limites; não demonstram que Auth, PostgREST, Storage e Realtime foram testados no destino de um preview.
- **Validação registrada na revisão financeira anterior:** 315 testes locais, lint e TypeScript aprovados. O Vinext passou com `npm run build`; o Next.js compilou com `next build --webpack --experimental-build-mode compile`, sem credenciais. PostgreSQL descartável validou 31 migrations daquela versão, atualização com dados sintéticos, papéis efetivos e concorrência de caixa. Esses resultados não incluem a nova política de ativação, não substituem o build completo na Vercel e não atestam produção.

### Versões de banco e ordem candidata

Na revisão anterior, a referência do responsável era a aplicação das três migrations originais de Compras:

1. `20261115120000_marketplace.sql`
2. `20261115121000_marketplace_dispatch.sql`
3. `20261115133000_marketplace_management.sql`

O checkout inclui também as quatro correções intermediárias:

1. `20261115140000_marketplace_security_integrity.sql`: permissões, privacidade e integridade.
2. `20261115142000_atomic_gps_assignment.sql`: vínculo e visibilidade do GPS.
3. `20261115143000_marketplace_notifications_and_push.sql`: notificações, inscrição Push e locks.
4. `20261115144000_marketplace_expiration_lock_order.sql`: ordenação de locks na expiração.

Depois das correções até `144000`, a ordem da revisão financeira era:

1. `20261115145000_marketplace_cash_integrity.sql`: adiciona campos de valor declarado, protege o histórico e desativa o registro sem valor. A RPC nova permanece sem autorização de uso pelo servidor até a etapa seguinte.
2. `20261115146000_marketplace_operation_mode.sql`: é a revisão pré-aplicação de `146000` que substitui o arquivo anterior `20261115146000_marketplace_test_only.sql`. Instala a política de operação fechada por padrão em ambos os modos, sem cadastrar nem habilitar o ambiente.

O histórico remoto não foi consultado. O responsável informou que já executou a nova `146000` com RLS. Não reaplicar migrations registradas; se houver dúvida sobre a versão instalada, conferir o histórico/DDL e preparar correção incremental quando necessário. Usar o mecanismo de [migrations do Supabase](https://supabase.com/docs/guides/deployment/database-migrations), em execução autorizada e com o projeto verificado. Em um banco de teste realmente novo, a instalação precisa partir da base completa do repositório.

**Revisão do modo de produção — validação local:** 124 testes aprovados (Compras 47, SQL local de Compras 13, notificações 3, corridas 34 e artefatos/PWA 27); lint, TypeScript, Vinext e compilação Next passaram. As 29 migrations anteriores coincidem por SHA-256 com a cópia já validada. Em PostgreSQL 17.12 descartável, o runner aplicou as 31 migrations do zero e validou a atualização de uma base sintética em `144000`, preservando pedidos, estoque e caixa legado. A `145000` isolada não concedeu execução da nova RPC ao servidor. Com a versão final, pausa e checkout simultâneos ficaram consistentes e novas compras ficaram bloqueadas depois da pausa. Logs ignorados em `work/prodroll-20261115/`. Nenhuma operação foi habilitada ou confirmada em produção.

## Roteiro futuro de produção: aplicativo antes do banco

O objetivo é limitar a transição à operação de **Compras**. Não há garantia de zero pausa para Compras: `145000` recusa o contrato antigo de caixa e `146000` fecha o fluxo até uma habilitação deliberada. Transporte e Entrega devem continuar independentes; não pausar seus workers, alterar tarifas ou mexer com configurações do serviço comum para concluir a atualização de Compras.

1. **Autorizar e planejar a janela de Compras.** Confirmar projeto, branch/artefato que a Vercel está servindo, permissões de mudança e situação do banco antes de um envio. Inventariar também URLs antigas de deploy e jobs que ainda podem alcançar código anterior com acesso ao banco. Revisar backup e recuperação, sem tentar restauração no projeto real. Se já houver Compras funcionando, esgotar pedidos ativos e registrar pendências de caixa ou repasse em procedimento aprovado antes da janela. Coordenar a pausa específica de Compras e o eventual agendador desse módulo. Não interromper a operação inteira como atalho.
2. **Publicar primeiro o app compatível, ainda com Compras pausada.** Futura implantação do código aprovado com o modo de operação ausente. Conferir que o histórico financeiro responde tanto com as colunas antigas quanto com as novas. No esquema antigo, datas permanecem legíveis e valores declarados/referências ausentes ficam desconhecidos; erro de permissão, indisponibilidade ou schema inesperado não autorizam leitura alternativa. Nenhuma versão deve tentar registrar caixa com a RPC antiga. Não criar pedidos nem lançar valores de teste no projeto real para verificar a pausa.
3. **Validar a atualização no laboratório e aplicar no destino só após nova autorização.** Conferir a ordem `145000` → `146000` e o histórico efetivo. Não executar as duas diretamente na esperança de que banco, cache do PostgREST, versão do aplicativo e abas antigas mudem juntos. Podem ocorrer bloqueios de DDL e propagação da nova API; manter a janela até o contrato e o deploy concordarem. Em caso de erro de migration, manter Compras fechada, registrar a falha sanitizada e investigar a partir da última versão registrada.
4. **Preparar produção sem abrir a operação.** Mesmo com o aplicativo atualizado, `private.marketplace_operation_environment` começa vazia. Somente o proprietário SQL, no Supabase efetivamente ligado à Produção, pode preparar o único registro com `operation_mode = 'production'`, um UUIDv4 próprio e `enabled = false`. Não cadastrar `isolated_test` no banco real. Na Vercel, configurar apenas no ambiente **Production**: `MARKETPLACE_OPERATION_MODE=production`, `MARKETPLACE_PRODUCTION_SUPABASE_URL` com a mesma origem HTTPS verificada de `NEXT_PUBLIC_SUPABASE_URL` e `MARKETPLACE_PRODUCTION_ENVIRONMENT_ID` com o UUIDv4 do registro privado. Habilitar as [variáveis de sistema da Vercel](https://vercel.com/docs/environment-variables/system-environment-variables): a operação exige `VERCEL=1`, `VERCEL_ENV=production` e `VERCEL_TARGET_ENV=production`. Não simular esses sinais em Preview/desenvolvimento; URL diferente também nega a operação. Confirmar a versão servida antes de seguir. Variáveis alteradas podem exigir novo deploy, que ainda deve ficar fechado no banco.
5. **Reabrir Compras apenas com autorização operacional explícita.** A RPC de servidor `market_confirm_operation_environment(uuid,text)` só confirma quando modo, UUID e `enabled` coincidem. O proprietário SQL altera somente `enabled` no registro correto depois das confirmações de versão, banco, escopo e regras financeiras. Os checks no ambiente real são de configuração e leitura, sem pedidos sintéticos, recebimento de teste ou repasse de teste. Isso não libera Pix, cartão, estorno, desconto, comissão ou repasse automatizado.
6. **Encerrar a janela e acompanhar somente operação autorizada.** Consultar os estados do deploy e logs sanitizados; observar Transporte/Entrega, pedidos e filas de Compras. Veicular atualização ao operador de Compras pelos canais autorizados: abas antigas podem continuar pedindo o contrato antigo mesmo com o deploy novo, e devem recusar o registro sem valor, nunca converter o esperado em recebido.

### Referência para o proprietário do banco — não executada

Estes exemplos **não são rotina de migração**, não devem ser incluídos em scripts de aplicação automática e não devem ser executados nesta missão. Somente após confirmação do destino e autorização futura, substituir o marcador abaixo por um UUIDv4 exclusivo desse ambiente. Um registro previamente encontrado com modo ou UUID diferentes deve ser investigado; não converter um registro de teste em registro real.

```sql
-- Preparação fechada: apenas após migrations, app compatível no ar e projeto verificado.
insert into private.marketplace_operation_environment
  (singleton, operation_mode, environment_id, enabled)
values (true, 'production', '<UUIDv4-DO-AMBIENTE>'::uuid, false)
on conflict (singleton) do nothing;

-- Conferência sem listar o UUID do registro.
select operation_mode, enabled,
       environment_id = '<UUIDv4-DO-AMBIENTE>'::uuid as identificador_confere
from private.marketplace_operation_environment
where singleton;

-- Abertura é uma etapa posterior, com autorização explícita e confirmação da versão.
update private.marketplace_operation_environment
set enabled = true
where singleton and operation_mode = 'production'
  and environment_id = '<UUIDv4-DO-AMBIENTE>'::uuid and not enabled;
```

Na preparação, a consulta deve retornar exatamente um registro com modo `production`, `enabled = false` e `identificador_confere = true`. Em qualquer outro resultado, parar e investigar; não executar a abertura.

Para pausar após uma eventual ativação autorizada, o proprietário SQL atualiza o mesmo registro para `enabled = false`, mantendo filtro pelo modo e pelo UUID. O bloqueio compartilhado faz a pausa esperar as transações comerciais que já passaram pelos gatilhos de escrita do banco; a pausa não estorna ou desfaz operações confirmadas. Não remover tabela, linha, migrations ou eventos para pausar. Antes de declarar incidente controlado, confirmar corte de novas operações e tratar as que já estavam em andamento segundo os procedimentos aprovados. Reverter um deploy não reverte banco e nunca deve restaurar a escrita antiga sem valor.

## Portão para eventual autorização de homologação separada

1. Confirmar o proprietário da integração GitHub, regras e permissões da branch, Vercel Connected Git Repository, **Production Branch**, domínios e Deploy Hooks, GitHub Apps/webhooks e outros sistemas que leem pushes. Confirmar que a branch de homologação só aciona um destino de Preview aprovado e não aciona publicação, migrations ou outras rotinas de produção. Não mudar a configuração produtiva para satisfazer esse portão.
2. Identificar time/projeto de Preview dedicado e quem pode acessá-lo. Usar [Deployment Protection](https://vercel.com/docs/deployment-protection) e testar acesso de uma sessão sem autorização, tanto à URL de branch quanto à URL única do deploy. Não adicionar domínio de produção nem promover o deploy. Preferir um projeto sem domínios de produção associados.
3. Provar que Auth, PostgREST, banco, Storage, Realtime, agendadores e serviços externos pertencem ao mesmo perímetro de teste. Registrar somente estado e evidência sanitizada. Usar contas, catálogo, endereços, dispositivos e pedidos sintéticos; não copiar banco, usuários, chaves, repasses, dispositivos ou inscrições de produção.
4. Confirmar as [variáveis efetivas de Preview](https://vercel.com/docs/environment-variables), inclusive heranças do ambiente e integrações. Vincular a URL e as chaves do Supabase exclusivamente ao projeto de teste. O segredo administrativo é somente servidor; `NEXT_PUBLIC_*` é incorporado ao build e precisa corresponder ao destino já nessa fase. Se houver URL canônica, usar a origem aprovável do preview, não a de produção. Não registrar valores em logs, Git ou neste arquivo.
5. Para permitir apenas testes de Compras no servidor, usar `MARKETPLACE_OPERATION_MODE=isolated_test`, `MARKETPLACE_TEST_SUPABASE_URL` igual à URL HTTPS de teste em `NEXT_PUBLIC_SUPABASE_URL` e `MARKETPLACE_TEST_ENVIRONMENT_ID` igual ao UUIDv4 do registro privado de modo `isolated_test` naquele banco de teste. Se também houver valores de URL ou ID de produção no ambiente, os valores de teste não podem coincidir com eles. O identificador sozinho não comprova isolamento. A execução de teste nunca deve ser habilitada em produção ou no banco real. Preview não aceita a configuração de produção e o pré-build exige os parâmetros de teste dedicados.
6. Deixar Pix/cartão e credenciais produtivas ausentes; nenhum pagamento ou repasse externo está autorizado. Geocodificação, roteamento, notificações e agendadores de teste só podem receber dados e inscrições sintéticas. Se for testar Push, usar VAPID e segredos distintos do ambiente real. Manter desativados os serviços cujo isolamento ainda não esteja comprovado.
7. Produzir evidência do build/testes para o conteúdo exato que entrará no Git: lint, TypeScript, suítes financeiras, regressão de Transporte/Entrega e build `npm run build:vercel` com as variáveis de teste. Conferir todos os nomes do índice, incluindo novos e ignorados, e revisar a versão preparada para garantir que não há chaves, dados reais ou anexos privados.

O bloqueio cobre novas compras, avanço comercial, despacho, recebimento e repasse. Consultas autorizadas e ações de segurança sobre pedidos anteriores, como recusar, cancelar ou registrar uma ocorrência sem avançar a entrega, não tornam a operação comercial disponível. Também não garantem que um Preview apontado ao banco errado ficaria sem acesso a dados reais: o isolamento do destino é obrigatório.

### Conferência local

Em PowerShell, a partir do checkout confirmado. Estes comandos apenas inspecionam o estado local:

```powershell
Set-Location -LiteralPath 'D:\Appmotoboy'
git status --short --branch
git branch --show-current
git diff --check
git diff --cached --name-status
git rev-parse HEAD
```

O envio autorizado é exclusivamente de `homologacao/marketplace-financeiro` a `origin`, sem merge ou deploy. Um eventual Preview precisa de autorização, projeto e ambiente dedicados; o deploy automático dessa branch está desativado na configuração do repositório. Não imprimir variáveis ou a resposta completa de ferramentas de credenciais.

## Smoke tests e comprovantes

Aguardando Preview real. **URL, ID de deployment, hash publicado e resultado de build remoto: não disponíveis.** Registrar data, SHA, ambiente, login de teste por papel, resultado e código de erro redigido; não publicar corpos de requisições, cookies, tokens, chaves ou PII.

| Papel/objetivo | Ação futura em ambiente protegido | Situação |
| --- | --- | --- |
| Sessão anônima | URL de Preview protegida; catálogo/ordens não acessíveis sem as autorizações previstas. | Não executado |
| Cliente | Login sintético, catálogo, preço/frete, checkout isolado, tentativa duplicada e acesso negado ao pedido de outra conta. Confirmar bloqueio no servidor se a configuração de homologação estiver incompleta. | Não executado |
| Comerciante | Login e pedidos somente da loja de teste, negar IDs de outra loja; pagamento e repasse separados do despacho. | Não executado |
| Motoboy | Login, oferta sintética, revalidação no aceite, retirada/entrega e recebimento registrado separadamente, sem tocar operação real. | Não executado |
| Central | Apenas perfil autorizado, visualização de pendências e divergências, trilha de auditoria e motivo quando aplicável. | Não executado |
| Transporte e Entrega | Navegação e fluxos críticos sobre o mesmo backend isolado; nenhuma interferência de Compras no despacho comum. | Não executado |
| Build e runtime remoto | Conferir SHA, Next.js, ambiente Preview, funções, headers, bloqueio comercial e erros sanitizados. | Bloqueado até publicação autorizada |

## Recuperação e limites

- **Operação:** na dúvida, revogar a configuração de teste (`MARKETPLACE_OPERATION_MODE`/atestação) e pausar apenas agendadores de homologação. A alteração de variáveis só afeta novos deploys; para interromper imediatamente um preview já publicado, restringir acesso ao ambiente ou desativá-lo pelo painel, sem mover domínios, e confirmar o bloqueio no servidor.
- **Aplicativo:** se for necessário recuperar o preview, selecionar uma versão conhecida e compatível no mesmo destino isolado, conferindo SHA, proteção e variáveis antes de gerar novo Preview. A versão anterior só é opção se a proteção e o bloqueio comercial forem preservados. Não usar rollback/promover de produção.
- **Configuração:** restaurar somente valores de teste confirmados para o Preview e repetir a checagem das rotas e do isolamento após o redeploy. Investigar logs no próprio painel, registrando apenas IDs/erros sanitizados. Se um segredo de teste for exposto, revogar no ambiente de teste e não reutilizar chaves reais.
- **Banco:** reverter app não reverte schema, pedidos, estoque nem caixa. Não remover tabelas, índices, políticas ou histórico aplicado com compras existentes. Preferir migration corretiva incremental; qualquer restauração depende de backup verificado em outra instância isolada, análise do impacto e autorização específica.

**Próxima etapa:** decidir separadamente como publicar a versão revisada e confirmar o destino. Preview continua dependente de Supabase isolado e acesso restrito. Produção requer o roteiro app-first, confirmação da versão servida e uma autorização separada para reabrir Compras.
