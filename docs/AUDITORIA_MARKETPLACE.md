# Auditoria do MotoPombal — 15/11/2026

**Decisão:** publicação bloqueada. O código e o SQL foram verificados localmente, inclusive em PostgreSQL real com sessões concorrentes. Ainda falta rodar o aplicativo contra uma instalação Supabase de homologação e testar em aparelhos.

## Inventário e baseline

- Checkout auditado: `D:\Appmotoboy`, branch `main`, commit inicial `10a3255fb7f70e87b09572a61386cc9963e305d3`. A implementação de Compras já estava no diretório de trabalho, sem staging, com 30 arquivos rastreados modificados e novos arquivos de código/teste/documentação. O anexo e as alterações existentes foram preservados.
- Node 24.13.0, npm 11.6.2, Next 16.3.8, Vinext 1.0.0-beta.5, React 19.2.8, TypeScript 5.9.3, PGlite 0.5.8. As versões foram lidas dos pacotes instalados. Nenhuma atualização de dependências, troca de branch ou sincronização remota.
- As rotas são páginas e handlers em `app/`; clientes Supabase no navegador usam Auth/Realtime, rotas privadas validam o servidor antes do cliente com `service_role`. O marketplace tem pedidos separados de corridas, estoque e snapshots em SQL, política de acesso por estabelecimento e caixa/repasse separados. Transporte e Entrega preservam o despacho existente.
- A árvore inicial tinha 25 migrations: 22 da base e as 3 de Compras (`20261115120000`, `20261115121000`, `20261115133000`). A auditoria acrescentou migrations incrementais; não alterou arquivos anteriores.
- Baseline padrão nesta execução: **283/283** testes (lógica, contratos e PGlite). Baseline dedicado de marketplace: **8/9**, com uma falha SQL em redispatch. A referência histórica de 148 testes permanece no documento da implementação.

## Achados, correções e evidência

| Severidade · achado | Reprodução e impacto | Correção e verificação |
| --- | --- | --- |
| P1 · desistência não redistribuía | Com `service_role`, aceite a entrega e peça desistência antes da retirada: SQLSTATE `42501` em `ride_approach_points`, abortando o retorno à fila. Transporte usava a mesma limpeza sem o grant. | `20261115140000_marketplace_security_integrity.sql` permite apenas ao servidor fazer o DELETE existente. `test:marketplace:db` verifica retomada e limpeza em Compras e Transporte e nega DELETE ao usuário comum. |
| P1 · contato do destinatário era consultável diretamente | Membro da loja podia selecionar telefone, endereço e coordenadas de `market_orders` apesar da projeção da API. A proteção por linha não limita colunas de uma linha autorizada. | A migration `140000` restringe as colunas acessíveis de pedidos, eventos e caixa. Consultas com o papel real `authenticated` no PostgreSQL confirmaram isolamento de linhas e a recusa de campos privados; a API mantém projeções próprias. |
| P1 · resposta perdida podia virar segundo pedido | Após checkout confirmado no banco, “Meus pedidos → Consultar tentativa” removia a chave, mas o carrinho permanecia. Voltar e confirmar usava outra chave. Em uma troca de conta, um resultado antigo também podia modificar carrinho/rota da conta nova. | A recuperação usa a mesma tentativa e limpa só o carrinho correspondente. Retomada consulta primeiro e não reenvia POST automaticamente. Geração da conta impede que resultados antigos afetem outra sessão. Regressões em `marketplace-checkout.test.ts`, complementadas pela disputa real de checkout com uma chave. |
| P1 · painel podia reter dados após negar acesso | Depois de bloquear a conta, retirar atribuição ou perder a sessão, respostas 401/403/404/410 deixavam dados privados anteriores em memória na interface. | Cliente invalida snapshots nesses casos; os painéis ligam carregamento/ações à geração de sessão. Regressões de lógica e handlers com fetch/Auth simulados cobrem logout, troca de conta e resultados fora de ordem. |
| P1 · GPS antigo ultrapassava a autorização inicial | Um POST autorizado antes da redistribuição podia ligar a posição a uma corrida sem aquela atribuição. A RLS antiga conferia a corrida e o cliente, mas não o motorista dela. | `20261115142000_atomic_gps_assignment.sql` revalida o vínculo no RPC e exige o mesmo motorista na RLS. O GPS não produz mais atualização redundante de disponibilidade no cadastro a cada amostra. `test:tracking` cobre associação legítima, POST atrasado e amostra preexistente inválida. Sem mudar os intervalos de coleta. |
| P1 · inscrição Push podia manter duas contas no mesmo endpoint | A desativação e a ativação eram escritas separadamente, permitindo interleaving com duas inscrições ativas. O dispositivo podia receber avisos da conta anterior. | `20261115143000_marketplace_notifications_and_push.sql` preserva registros históricos, normaliza duplicatas ativas, cria unicidade e troca associação em transação. Testado em SQL e com lógica de validação do encaminhamento. |
| P1 · aviso de oferta podia chegar depois de expirar | A fila não conferia se a oferta ainda estava pendente e o TTL fixo podia ultrapassar a janela. A fase de processamento também precisava proteger o resultado contra um worker atrasado. | Despachante confere oferta, destinatário e inscrição, limita TTL à validade e conclui somente se ainda possuir a reserva daquela tentativa. O Service Worker ignora oferta vencida. Testes de lógica e duas conexões comprovam a reivindicação única no SQL; nenhum Push externo. |
| P2 · transições de Compras sem avisos operacionais | O histórico persistia eventos, mas pedido novo, preparo, entrega e vários estados de exceção ficavam restritos à consulta manual/polling. | A migration `143000` cria avisos e enfileira de forma transacional, com destinatário autorizado, deduplicação e conteúdo mínimo. Testados commit, rollback e leituras autorizadas em PGlite. Realtime integrado e entrega física continuam pendentes. |
| P1 · expiração concorrente podia abortar um lote | Dois workers reivindicaram lotes distintos com produtos compartilhados em ordem inversa. No PostgreSQL 17.12 um recebeu SQLSTATE `40P01`; 2 pedidos expiraram e 2 ficaram pendentes. | `20261115144000_marketplace_expiration_lock_order.sql` bloqueia todo o conjunto de produtos em ordem de ID antes das liberações. No mesmo teste, os dois workers concluíram: 4 pedidos expirados, 4 eventos, nenhum pendente. Não houve efeito parcial no lote abortado no baseline. |

Notas de escopo: checkout é em dinheiro e a contabilidade registra separadamente produtos, frete, recebimento e repasse. Pix, cartão e recorrência não foram ativados. Sem integração efetiva, o teste da regra de caixa não autoriza cobrança. Não houve alteração de regra de tarifa, política global de despacho ou aumento de frequência de GPS. Fotos continuam limitadas a tipos aceitos e ao estabelecimento autorizado.

## Regressão final

| Comando | Resultado desta execução |
| --- | --- |
| `node node_modules/tsx/dist/cli.mjs --test --test-concurrency=1` com todos os `tests/*.test.ts`, `tests/*.test.mjs` e `tests/*.integration.mjs`, exceto `production-stage9.test.mjs` | **278/278 APROVADOS**, sem chamadas externas. Inclui dinheiro, tarifas, GPS, segurança, Compras e regressão de Transporte/Entrega. |
| `npm run test:production`, após os builds | **27/27 APROVADOS** no escopo local (bundles, PWA e PGlite). Total final combinado: **305 testes** sem somar repetições. |
| `npm run test:marketplace`, `test:marketplace:db`, `test:marketplace:notifications`, `test:tracking` | Rodadas focadas aprovadas: **35/35, 10/10, 3/3 e 17/17**, já contadas na bateria final. O primeiro fixture de tracking criou `service_role` sem `BYPASSRLS`; a identidade de teste foi corrigida para reproduzir o papel efetivo e o reteste passou. |
| `npm run lint`; `node node_modules/typescript/bin/tsc --noEmit --incremental false` | **APROVADOS**. |
| `npm run build`; `node node_modules/next/dist/bin/next build --experimental-build-mode compile` | **APROVADOS**. O segundo comando é só compilação; não comprova prerenderização ou implantação. |
| `npm run build:vercel` | **BLOQUEADO** corretamente pelo preflight: faltam URL, chave pública e chave server-side do Supabase. Nenhuma configuração real foi carregada. |
| `scripts/test-marketplace-postgres.py` e roteiro de papéis efetivos | **APROVADOS** nos cenários SQL descritos em [HOMOLOGACAO_SUPABASE.md](HOMOLOGACAO_SUPABASE.md), em paralelo aos testes Node. |

## Limites e portões

| Verificação | Resultado |
| --- | --- |
| Runtime PostgreSQL portátil e isolamento | **APROVADO**. Conexão TCP em loopback com instância descartável verificada; somente dados sintéticos. |
| Instalação limpa, atualização e histórico | **APROVADO** no PostgreSQL local; o mecanismo local registra versão/hash e não repete arquivos aplicados. Nenhum histórico remoto foi consultado ou alterado. |
| RLS, permissões e caixa | **APROVADO** no SQL local para a matriz executada. **BLOQUEADO** para sessões reais de Supabase Auth/PostgREST/Storage/Realtime. |
| App integrado e sessões de navegador | **BLOQUEADO** por falta de instância Supabase completa e isolada. O checkout em VM é evidência de lógica, não de operação integrada. |
| GPS, Push e PWA em campo | **NÃO EXECUTADO** em Android/iOS reais. Nenhum aparelho, VAPID, provedor ou agendador de homologação foi usado. |
| Pix/cartão/recorrência real | **NÃO APLICÁVEL** à versão auditada. Não se devem habilitar cobranças para testar este fluxo. |
| Publicação | **BLOQUEADA**. Gate Vercel sem as variáveis obrigatórias do Supabase; backend completo e testes físicos pendentes. |

Para evidências de banco, reprodução com duas conexões e recuperação, veja [HOMOLOGACAO_SUPABASE.md](HOMOLOGACAO_SUPABASE.md). Para o roteiro por perfil, mapa e notificações, veja [HOMOLOGACAO_OPERACIONAL.md](HOMOLOGACAO_OPERACIONAL.md).

Próxima etapa: preparar Supabase exclusivo de homologação com endpoint HTTPS e agentes de teste, revisar o histórico desse projeto e aplicar a ordem aprovada apenas nesse destino. Em seguida, rodar o fluxo completo com cliente, loja, motoboy e central em sessões independentes, incluindo dois aparelhos e os agendadores. Não houve staging, commit, push, deploy ou SQL fora dos bancos descartáveis.
