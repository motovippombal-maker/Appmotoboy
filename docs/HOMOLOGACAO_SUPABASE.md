# Homologação SQL do MotoPombal — 15/11/2026

**PostgreSQL local:** instalação, atualização, RLS e testes concorrentes executados com sucesso no escopo descrito. **Supabase completo:** pendente. Este documento não autoriza execução nem alteração em produção.

## Instância e comprovação de isolamento

| Ambiente | Evidência |
| --- | --- |
| Inicial, PGlite 0.5.8 | Instâncias novas em memória sem URL ou DataDir, criadas pelo processo Node. Versão do motor 18.3; `inet_server_addr()` e `inet_server_port()` nulos. Bootstrap de papéis e identidades fictícias. |
| PostgreSQL nativo | [Binários portáteis](https://www.postgresql.org/download/windows/) PostgreSQL 17.12, sem serviço registrado. Instância em `D:\Appmotoboy\work\audit-20261115\pg-audit-cluster`, cluster `motopombal-audit-20261115`, listener exclusivamente `127.0.0.1:55437`, acesso autenticado com segredo descartável. Consultas de prova conferiram endereço, porta, banco, nome do cluster, DataDir, configuração de escuta e versão antes de aplicar SQL. |
| Supabase | CLI 2.72.7 disponível; não havia configuração local do projeto, Docker/Podman funcional nem distribuição WSL registrada. Não foi feito link com projeto remoto. Os schemas `auth` e `storage` de teste têm a estrutura mínima para executar FKs, DDL, grants e políticas; não são serviços HTTP de Auth ou Storage. |

Todos os dados de cliente, motorista, estabelecimento, GPS e valores eram de fixture. Nenhum registro real ou variável de produção foi usado. A publicação SQL `supabase_realtime` foi criada para validar migrations; não houve servidor Realtime. A documentação [Supabase Local Development](https://supabase.com/docs/guides/local-development) descreve os requisitos do runtime completo.

## Ordem e histórico

1. Aplicar, em ordem crescente, as 22 migrations anteriores desde `20260927190000_moto_vip_mvp.sql` até `20261020131000_recover_unoffered_rides.sql`.
2. `20261115120000_marketplace.sql`: catálogo, pedidos, estoque, caixa, funções e políticas.
3. `20261115121000_marketplace_dispatch.sql`: vínculo com corridas, reservas, ofertas, aceite, reprocessamento e ocorrências.
4. `20261115133000_marketplace_management.sql`: gestão e políticas de upload.
5. `20261115140000_marketplace_security_integrity.sql`: grant de redistribuição do servidor e restrição de colunas.
6. `20261115142000_atomic_gps_assignment.sql`: revalidação do vínculo da localização e RLS.
7. `20261115143000_marketplace_notifications_and_push.sql`: validade operacional, inscrição atômica, avisos e ordem de locks.
8. `20261115144000_marketplace_expiration_lock_order.sql`: ordenação global de locks de estoque do lote de expiração.

O runner [test-marketplace-postgres.py](../scripts/test-marketplace-postgres.py) usa `psql` explícito em TCP loopback. Cada arquivo executa em transação e grava versão + SHA-256 na mesma transação em uma tabela do laboratório. Divergência de hash, falha SQL ou destino diferente abortam a sequência. Isso comprova versionamento do teste local; a tabela do laboratório não é o histórico gerenciado do Supabase.

- **Instalação limpa APROVADA:** todas as **29 migrations** em banco recém-criado. Reconsulta registrou **0** pendentes (rodada `final1`).
- **Atualização APROVADA:** 22 migrations antigas, corrida de passageiro e entrega sintéticas, três migrations originais de Compras e cinco pedidos sintéticos preexistentes. Após as quatro correções, os dois valores e tipos de corrida e a assinatura das linhas de pedido, itens, eventos, reservas e caixa permaneceram iguais. Reconsulta registrou **0** pendentes (rodada `existing --upgrade-only`).
- Usar um sufixo novo a cada rodada. O runner recusa substituir banco. Não execute contra configuração de produção nem execute o arquivo de fixture sem o guard explícito.

Exemplo somente para um laboratório já inicializado e verificado:

```powershell
python scripts/test-marketplace-postgres.py --psql <psql.exe> --password-file <arquivo-de-teste> --data-dir <cluster-descartavel> --cluster-name motopombal-audit-20261115 --port 55437 --run outra1
```

## Papéis, financeiro e concorrência

| Escopo | Resultado observado |
| --- | --- |
| Cliente A/B, proprietário, membro de outra loja, motoboy, admin, visitante | **APROVADO no SQL**, por `SET LOCAL ROLE` e identidade fictícia em sessão. Confirma leituras próprias, acesso por estabelecimento, escopo de colunas, bloqueio de escrita/RPC e perda de leitura da entrega pelo motorista após completar. Autenticação de sessão real: **BLOQUEADA**. |
| Storage | **APROVADO no SQL de fixture:** políticas restritivas do bucket bloqueiam INSERT/UPDATE/DELETE direto, mesmo com política permissiva preexistente. Outro bucket de teste permaneceu permitido. Upload/assinatura/URL via serviço real: **BLOQUEADO**. |
| Checkout e estoque | **APROVADO**, último item teve um vencedor; a mesma chave gerou um pedido e uma reserva. Antes do commit uma exceção injetada desfez a criação e o estoque; após commit, descartar a resposta e repetir recuperou o pedido. Conflito de payload da mesma chave também coberto no teste de integração. |
| Dinheiro e repasse | **APROVADO** para o SQL testado: confirmação da entrega não paga automaticamente; terceiro não registra caixa; recebido/repasse e seus atores são independentes; duas sessões registraram no máximo um evento de repasse. Não houve pagamento real, Pix, cartão ou rede externa. |
| Ofertas e atribuição | **APROVADO** na concorrência testada: dois motoristas concorrentes, só o ofertado aceitou; dois pedidos disputando um elegível deixaram uma reserva. Aceite concorrente a offline, cancelamento ou processamento de oferta expirada preservou os estados esperados. A prioridade do preferencial, recusa, GPS antigo e fallback também passaram na suíte PGlite. |
| Funcionários e expiração | **APROVADO**: duas sessões da loja com decisões conflitantes não alteraram o mesmo pedido duas vezes. Cancelamento/expiração liberaram estoque uma vez. |
| Workers | **APROVADO**: duas sessões despacharam a mesma tarefa devida e criaram uma oferta. A reivindicação SQL da mesma entrada da fila Push teve um vencedor. A rede de Push ficou fora do teste. |
| Expiração de lotes cruzados | Baseline **REPROVADO**: lotes com X→Y e Y→X, um deadlock `40P01`, 2 cancelados/2 pendentes/2 eventos. Após `144000`, **APROVADO**: os dois workers concluíram, 4 cancelados/0 pendentes/4 eventos. |

O runner usa duas conexões independentes `psql`, uma barreira consultada em `pg_stat_activity`, timeout local de lock/consulta e conferência do estado final após commit. Não usa uma fila de chamadas em uma só conexão. Os logs sanitizados ficam em `work/audit-20261115/`; a emissão de notificações externas, o serviço Supabase e o campo continuam fora da evidência.

O roteiro [marketplace-effective-roles.sql](../tests/marketplace-effective-roles.sql) pode ser repetido após o seed [marketplace-concurrency-fixture.sql](../tests/marketplace-concurrency-fixture.sql), antes dos testes que assentam o repasse. O arquivo confere destino local e marcador explícito de laboratório, alterna papéis efetivos e dá rollback das alterações de teste.

## Recuperação e próxima etapa

Para homologação Supabase, preparar Auth, Storage, Realtime, HTTPS e os agendadores em projeto dedicado; conferir identidade do destino, histórico e backup antes de rodar a lista em ordem. Configurar áreas/tarifas e somente contas de teste. Migrações já registradas não devem ser reaplicadas à mão.

Rollback do aplicativo: em etapa autorizada e após conferir compatibilidade, pode-se retirar o frontend que expõe Compras e pausar os agendadores correspondentes. Rollback do banco: não remova tabelas, permissões ou índices às cegas. Uma reversão do índice de corrida ativa pode falhar se já houver compras coexistindo; apagar tabelas perderia pedidos/financeiro. Prefira correção incremental. Para restaurar backup, teste primeiro em instância separada; não houve restauração ou rollback destrutivo em banco compartilhado.
