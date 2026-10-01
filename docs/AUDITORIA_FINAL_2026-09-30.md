# MotoPombal — auditoria de produção de 30/09/2026

## Decisão

**NÃO LIBERAR AINDA.** O código local passou nas verificações abaixo. Em retorno posterior, o responsável informou sucesso ao executar a nova migration; a RPC aparece no catálogo REST do Supabase configurado neste checkout. Ainda faltam confirmar o ambiente, backup/histórico e grants no banco, além de homologar o fluxo com dois aparelhos, PostgreSQL real, GPS, Realtime e PWA. Nenhum deploy ou alteração remota foi executado pelo agente.

## Falhas confirmadas e correções

| Prioridade | Falha encontrada | Correção |
| --- | --- | --- |
| P0 | A API de disponibilidade podia ler ausência de corrida e gravar `available=true` depois de um aceite concorrente. | A nova RPC bloqueia a linha do motorista, consulta a corrida ativa e atualiza disponibilidade/localização na mesma transação. Offline com corrida ativa é rejeitado. |
| P0 | Um POST de pedido podia gravar a corrida e perder a resposta; a tela mantinha a cotação e oferecia nova tentativa. | Antes de mostrar falha, o cliente consulta a corrida ativa no servidor. O botão recebe trava síncrona contra toque duplo. O POST não é reenviado automaticamente. |
| P1 | Atualizações Realtime/polling sobrepostas podiam publicar um snapshot antigo de corrida ou perfil após um mais recente. | Gerações de sincronização descartam respostas superadas; o pedido concluído invalida leituras em andamento. |
| P1 | Se o motorista aceitasse enquanto o áudio ainda inicializava, o alerta antigo podia instalar temporizadores depois de ser parado. Atualizações da mesma oferta também reiniciavam o som. | O controlador invalida inicializações antigas, e o efeito identifica a oferta por ID e validade. |
| P1 | O botão de mensagem do motorista não tinha ação; o contato direto ocupava o GPS. | Um botão discreto abre painel inferior com passageiro, ligação e SMS; ao fechar, o mapa volta. O botão equivalente fora do GPS também abre o painel. |
| P2 | O botão de mensagem do passageiro e o atalho de suporte do motorista eram inertes. | SMS para o número cadastrado e link de e-mail de suporte. A entrega do endereço de suporte ainda precisa ser verificada. |
| P2 | Erros de validação podiam expor texto técnico da biblioteca. | Resposta de validação padronizada em português. |

## Arquivos alterados nesta auditoria

- `supabase/migrations/20260930150000_atomic_driver_status.sql` — nova RPC com permissão apenas para `service_role`.
- `app/api/drivers/status/route.ts` — uso da RPC atômica.
- `hooks/use-moto-vip.ts` — recuperação do pedido e controle de respostas antigas.
- `app/page.tsx`, `app/globals.css` — trava de pedido, contato e alertas do motorista.
- `lib/driver/ride-alert.ts` — cancelamento seguro da inicialização de áudio.
- `lib/backend/api.ts` — mensagem de validação amigável.
- `tests/ride-lifecycle.integration.mjs`, `tests/driver-alert.test.ts` — regressões.

## Evidência executada

| Verificação | Resultado e limite |
| --- | --- |
| Testes automatizados locais | **175/175 aprovados**. Incluem fila sem raio, rodízio, aceite concorrente simulado, transições, dinheiro, RLS, GPS, reconexão, PWA e novas regressões. Testes SQL usam PGlite em uma instância; não comprovam concorrência entre conexões PostgreSQL reais. |
| Migrations | **17/17 executadas em ordem em PGlite isolado** pelos testes de integração. O responsável informou `Success. No rows returned` para a nova migration; consulta OpenAPI de leitura com a chave de servidor retornou HTTP 200 e listou `/rpc/set_driver_online_status` no Supabase configurado. A consulta SQL enviada pelo responsável confirmou `existe=true`, `servidor=true`, `usuario=false`, `anonimo=false`. |
| Next/Vercel | `npm run build:vercel` aprovado. |
| TypeScript | `npx tsc --noEmit --incremental false` aprovado antes da última revisão; o build final executou TypeScript e passou. |
| ESLint | Zero erros; um aviso anterior de `AdminPanel` não utilizado em `app/page.tsx`. |
| Segurança de bundle | Teste local não encontrou segredo privado conhecido no bundle público. Chave administrativa antiga e RLS remoto não puderam ser verificados aqui. |

## Fluxos críticos e cenários A–S

| Cenários | Resultado local | Falta para homologar |
| --- | --- | --- |
| A–D: um/vários passageiros e motoristas, dois aceites | Passaram testes de despacho/aceite em PGlite. | Contas de teste, aparelhos simultâneos e PostgreSQL multi-conexão. |
| E: dois toques em solicitar | Índice único existente no banco; trava imediata e recuperação de POST ambíguo adicionadas. | Duplo toque e resposta perdida em rede móvel real. |
| F–J: perda de rede e reabertura em oferta/corrida | Código consulta corrida ativa na inicialização/retorno e testes locais cobrem reconexão/Realtime. | Desligar rede, fechar PWA e retomar em dois celulares. |
| K–L: GPS negado/indisponível | Testes locais de mensagens, timeout e origem manual passaram. | Permissões e GPS físicos. |
| M–N: motorista offline/online | Novas regressões de disponibilidade e retorno da pausa passaram. | Concorrência real entre status e aceite. |
| O–P: cancelamento/finalização | Transições e idempotência passaram em PGlite. | Corrida real de teste e financeiro em staging. |
| Q: posição na fila | Rodízio, avanço, pausa e retorno passaram em PGlite. | Observar atualizações simultâneas no PWA e painel ADM. |
| R: suspensão pelo ADM | Testes de autorização e exclusão da fila passaram. | Operação autenticada em staging. |
| S: Realtime desconecta/reconecta | Testes de estado e ressincronização passaram. | Queda real de websocket e retorno em aparelho. |

## Segurança, serviços externos e versão futura

- **Supabase remoto:** os grants da nova RPC foram confirmados pela consulta SQL do responsável. Confirmar em qual ambiente a migration foi executada e verificar histórico, backup, RLS, comportamento da função e concorrência PostgreSQL. A presença e os grants não comprovam seu comportamento em uma corrida real.
- **Credenciais:** `SUPABASE_SECRET_KEY` permanece somente no servidor pelo código inspecionado. A rotação/revogação de uma chave administrativa antiga citada no checklist anterior continua sem comprovação.
- **Publicação:** `NEXT_PUBLIC_SITE_URL` não estava configurada no build local. HTTPS, redirects de Auth, domínio, SMTP e instalação PWA precisam de validação operacional.
- **Notificações:** Push depende de VAPID e `PUSH_DISPATCH_SECRET`; o build informou ambos ausentes. O alerta em primeiro plano tem som/vibração, sujeito às permissões do aparelho.
- **Pagamento:** somente dinheiro está disponível para novas corridas; Pix permanece bloqueado até provedor homologado. Cartão e carteira não fazem parte desta entrega. A confirmação de recebimento em dinheiro é separada da finalização.
- **Comunicação:** ligação e SMS dependem do discador/mensageiro do aparelho; não há chat interno. O endereço de suporte configurado deve ter entrega verificada.
- **Recuperação de senha:** o fluxo por celular ainda fornece apenas orientação para contatar a central; não há verificação de posse do número nem redefinição automática. Precisa de um procedimento operacional seguro ou de um provedor de verificação antes da abertura pública.
- **GPS em segundo plano:** PWA não garante rastreamento contínuo com tela bloqueada; medir nos aparelhos e ressincronizar ao retomar.

## Portão de entrega

Confirmar ambiente e backup da migration informada como aplicada, testar em Supabase/PostgreSQL real, executar uma corrida completa passageiro–motorista–ADM em dois aparelhos com rede instável, confirmar pagamento em dinheiro, GPS, fila, Realtime e PWA; depois repetir a bateria e decidir GO/NO-GO. Até lá, o resultado é **NÃO LIBERAR**.
