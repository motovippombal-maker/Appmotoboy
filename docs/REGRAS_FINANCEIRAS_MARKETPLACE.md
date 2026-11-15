# Regras financeiras do MotoPombal — 15/11/2026

**Operação comercial real não ativada por esta revisão.** A blindagem financeira foi elaborada e verificada localmente com registros sintéticos. Em atualização posterior, o responsável informou que só dispõe de ambientes de produção e que faltam as migrations `145000` e `146000` no Supabase que usa. A referência anterior de que só as três primeiras estavam aplicadas é histórica. Não consultamos o histórico remoto, não publicamos o aplicativo e não aplicamos SQL real.

## Modelo encontrado e correções

O checkout já calculava preços e frete no servidor, gravava os itens e a tarifa cotada e criava uma previsão de caixa. O caixa antigo, entretanto, carimbava recebimento e repasse sem guardar o valor informado. A interface podia assim mostrar o total esperado como se fosse dinheiro recebido. O painel também não separava claramente parcela prevista da loja de repasse já registrado.

A migration `20261115145000_marketplace_cash_integrity.sql` e as rotas passam a registrar **valor declarado**, ator, data e referência quando aplicável. O campo esperado nunca vira valor recebido automaticamente. Registros antigos com data e sem valor continuam com valor desconhecido; não há backfill inferido, exclusão de eventos ou criação de receita. A RPC antiga, sem valor, recusa a ação. A RPC nova não fica disponível para o servidor entre `145000` e `146000`, evitando abertura parcial.

| Regra | Implementação e evidência |
| --- | --- |
| Produtos e complementos | Preço e quantidade revalidados no servidor e no banco antes do fechamento; componentes em centavos inteiros. Item e preços já consolidados são imutáveis nas operações da aplicação. Comprovado em laboratório. |
| Frete | Preserva tarifa por região, áreas habilitadas e cotação assinada com a revisão da regra. Distância/rota informam a estimativa, mas não definem cobrança por km. Revalidado no checkout; comprovado nos testes locais. |
| Total e parcelas | O total de Compras é produtos e complementos mais o frete no modelo atual. Desconto de Compras não é oferecido; o checkout exige zero de desconto nesta versão. A parcela prevista da loja é o subtotal dos produtos; a do entregador é o frete. A participação técnica da plataforma é zero no modelo atual; isso não aprova comissão ou receita futura. Consistência de soma e vínculo com as linhas comprovados no laboratório. |
| Quem recebe | Entregador vinculado ou central autorizada registra uma declaração de dinheiro do pedido entregue. O dinheiro dos produtos continua obrigação com a loja; o frete é uma parcela prevista, não o valor que entrou no caixa do motorista. Comprovado com contas e valores sintéticos, sem recebimento comercial. |
| Confirmação de entrega | Muda a logística. Não declara recebimento e não repassa dinheiro. Comprovado em SQL. |
| Divergência | A diferença entre o declarado e o esperado aparece por pedido. Valor zero explicitamente declarado continua zero e pode gerar diferença; valor antigo ausente continua desconhecido. Divergência ou legado sem valor trava o repasse e exige conferência pela central. Comprovado em laboratório. |
| Repasse | O responsável autorizado declara o valor exato da parcela da loja, com referência, após recebimento sem divergência. A operação não transfere dinheiro nem verifica extrato automaticamente. Repetição com os mesmos dados é idempotente; conflito de valor/referência é rejeitado. Comprovado com sessões PostgreSQL independentes. |
| Cancelamento | Ações autorizadas de pedidos já existentes, antes da entrega, continuam a liberar a reserva conforme o fluxo existente, sem simular pagamento ou estorno. Comprovado em SQL. |
| Estorno/ajuste após recebimento | **Decisão comercial pendente.** A API/RPC não registra estorno, ajuste livre, suposta prova bancária ou repasse parcial. Exceções devem ser apuradas sem sobrescrever o histórico. |
| Meios de pagamento | Dinheiro é um registro de declaração, sem movimentação automática. Pode ser exercitado em teste isolado ou, futuramente, no modo de produção explicitamente autorizado. **Pix e cartão desativados** no marketplace; nenhum provedor/conector de cobrança foi ativado. |

Entradas do caixa aceitam reais com até duas casas decimais, sem separador de milhares, e convertem os dígitos para inteiro em centavos. Montante negativo, decimal em centavos, ausente ou acima do limite técnico não é aceito. Não há arredondamento por km nem ajuste silencioso de divergência. Quando o catálogo ou o frete muda, a cotação anterior não autoriza o novo total.

## Conciliação, autorização e limites

- O painel separa compras entregues (total previsto), caixa com valor declarado, entregas ainda sem recebimento registrado, parcelas previstas, repasse declarado e diferenças a maior/a menor. O filtro de conferência indica o pedido e histórico envolvidos. O recorte é de **até 100 pedidos recentes da loja selecionada**; não é extrato integral nem prova bancária.
- Loja e central consultam somente o escopo autorizado; o entregador vê o necessário para sua entrega. A loja não assume a identidade do entregador para declarar caixa. A central pode auditar casos e o papel de aplicação não regrava itens, preços, referências já lançadas nem eventos financeiros. Não inclua CPF, chave Pix, número de conta ou senha nos campos de referência.
- A chave de tentativa de checkout é vinculada a cliente e conteúdo. As escritas financeiras têm restrições de integridade, revisão da autorização, locks e evento único. Se a confirmação se perder após commit, a repetição devolve o registro correspondente sem duplicar estoque ou crédito.
- O aplicativo de transição lê os campos antigos e novos para preservar o histórico durante a janela. Somente falta confirmada de campos específicos autoriza a projeção antiga; erro de acesso ou falha de conexão não autoriza leitura alternativa. Momento registrado sem montante declarado é legado desconhecido, não recebimento/repasse verificado, e impede registro de novo repasse sem conferência. Nenhuma escrita usa esse fallback.
- A versão ainda não aplicada `20261115146000_marketplace_test_only.sql` foi substituída localmente por `20261115146000_marketplace_operation_mode.sql`. Ela instala Compras **fechada por padrão**, inclusive no banco. Somente o proprietário SQL pode preparar e habilitar o registro privado do ambiente. `isolated_test` exige um Supabase dedicado e nunca deve ser armado no banco real. O modo `production` exige runtime Vercel de produção, URL HTTPS verificada, UUIDv4 correspondente e autorização explícita para abrir o registro do banco. Leitura autorizada e ações de proteção sobre registros anteriores não abrem novas compras.
- Se já houver pedidos ativos em Compras, planejar a drenagem e registrar pendências antes de publicar o aplicativo de transição com o módulo pausado. Aplicar `145000` e então `146000` somente em execução futura autorizada, depois de confirmar o destino. O modo de produção administra a abertura a partir do registro fechado; não altera tarifas, Pix, cartão ou a operação comum de Transporte e Entrega. Não executar no projeto real pedidos sintéticos, recebimentos de teste ou repasses de teste para atestar a atualização.

## Decisões para antes de uma eventual ativação

| Item | Situação |
| --- | --- |
| Frete mínimo, preço por km, distância máxima para cobrança | **Não aplicáveis** à tarifa por região já usada. Não configurar só para preencher campos. A área de serviço continua sendo decisão de operação por polígono; filtros do despacho por distância servem à seleção de entregadores. |
| Comissão de pedido/entrega, taxa da plataforma, descontos comerciais de Compras | **Pendentes**. Não há cobrança, porcentagem, desconto ou frete gratuito aprovado por esta missão. Cupons e tarifas de Transporte/Entrega não foram redefinidos. |
| Prazo, responsáveis e comprovantes aceitos no repasse | **Pendentes de validação comercial.** A referência atual rastreia uma declaração; prazo e validação externa não foram inventados. |
| Ocorrências, sobra/falta em caixa, estorno ou retificação de legado | **Pendentes de política e autorização.** O bloqueio em caso de divergência é deliberado; a próxima etapa deve definir procedimento auditável sem alterações diretas no histórico. |

## Validação registrada na revisão financeira anterior

- O baseline anterior às alterações rodou novamente: **305/305** testes.
- Em PGlite isolado, `npm run test:marketplace:db` aprovou **12/12**, inclusive caixa legado, valores negativos e ausentes, checkout repetido, valor divergente, autorização, imutabilidade, repasse, liberação e ausência de estorno fictício.
- PostgreSQL 17.12 de loopback: **31 migrations** desde zero, e atualização de uma base anterior com Transporte, Entrega e Compras sintéticos preservados. Nova verificação encontrou zero pendentes. Chamadas simultâneas de recebimento e repasse geraram uma movimentação de cada tipo; checkout/estoque, cancelamento e falha transacional passaram.
- O runner `scripts/test-marketplace-postgres.py --roles-only` aprovou a matriz de papéis PostgreSQL efetivos, RLS de pedidos, repasse e políticas de Storage sobre tabelas de teste. Não houve Storage HTTP ou Auth real.
- Regressão final: **315/315** testes (288 no conjunto principal, mais 27 de `npm run test:production` após gerar os bundles). Também passaram `npm run lint`, `tsc --noEmit --incremental false`, `npm run build` do Vinext e a compilação Next.js com `next build --webpack --experimental-build-mode compile`. Dois testes intermediários tinham fixtures do contrato antigo; a validação final passou com as fixtures atualizadas. O teste do ambiente de Preview com valores sintéticos checou configuração, sem consultar nenhum endereço.
- Nenhum teste atesta dinheiro recebido em comércio real. Supabase Auth/PostgREST/Storage, Preview Vercel, smoke tests por perfil e provedor financeiro não foram homologados. Logs sanitizados ficam no diretório local ignorado `work/finance-20261115/`.

Antes de avaliar ativação futura: confirmar política de cobrança e critérios de conferência, testar as migrations e o modo no laboratório descartável com dados sintéticos e validar recuperação sem tocar produção. Preview continua a exigir Supabase de homologação e acesso protegido. A decisão de aplicar a versão, testar configuração no destino ou reabrir Compras em produção exige autorização separada. Veja [ordem, bloqueios e recuperação](PUBLICACAO_MARKETPLACE.md).

A revisão de produção foi validada separadamente: `145000` isolada preserva checkout, logística e histórico, com escritas de caixa fechadas. `146000` concede o contrato novo sob a guarda do banco, ainda desabilitado. Passaram os testes de atualização com registros anteriores, autorização por papel, declarações concorrentes de caixa e pausa concorrente com checkout no PostgreSQL descartável. A operação real continua desativada.
