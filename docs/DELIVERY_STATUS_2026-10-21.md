# Delivery de restaurantes — estado em 21/10/2026

## Implementado no repositório

- Auditoria da arquitetura existente e restrições permanentes em `AGENTS.md`.
- Migrations aditivas para restaurantes, equipe, categorias, produtos, adicionais, preferências de entregador, pedidos, histórico de estados, pagamento na entrega, localização ativa, favoritos, avaliações, imagens, notificações e endereços salvos.
- Pedido transacional com preços e adicionais recalculados no PostgreSQL, cotação validada novamente, chave de idempotência, valor de frete independente das corridas e retratos dos itens/endereço.
- Estados controlados no banco; restaurante aceita e prepara, motoboy aceita, restaurante confirma retirada, motoboy retira e entrega. Dupla atribuição de corrida e entrega é barrada no banco.
- Cliente: acesso ao delivery no aplicativo atual, busca real por restaurante/produto, cardápio, personalização, carrinho, endereço salvo e ponto no mapa, cotação, checkout, histórico, acompanhamento, repetir pedido, favoritos e avaliação após entrega.
- Restaurante: pedido de parceria, cardápio, disponibilidade, envio de imagens, equipe por conta MotoPombal existente, pedidos em tempo real com recuperação por consulta e indicadores brutos de pedidos.
- Motoboy: habilitação para delivery, entregas prontas, aceite, rota externa, marcos de entrega, devolução antes da retirada, GPS apenas durante a entrega ativa.
- Administração: aprovação/suspensão, configuração de taxa e métodos presenciais, pedidos, indicadores e cancelamento operacional.
- Confirmação manual e auditada do dinheiro/cartão recebido na entrega. Duplicatas não criam dois recebimentos.
- Notificações persistidas para cliente, restaurante e entregador nas etapas do pedido, usando a fila push existente quando ela estiver configurada. Ao ficar pronto, o pedido alerta até 30 motoboys elegíveis, priorizando GPS recente; somente um consegue aceitar.

## Ainda necessário para operação comercial completa

- **Migration ainda não aplicada** a nenhum banco real; nenhuma página nova foi homologada com contas reais.
- Configurar valores reais de frete e distância máxima e ativar delivery no painel administrativo. A migration deixa a operação desativada e não cadastra tarifa fictícia.
- Homologar maquininha e o responsável pelo recebimento antes de habilitar cartão na entrega. Cartão começa desativado.
- Integrar provedor real de Pix e cartão online, webhooks assinados, cancelamento e reembolso. Nenhuma cobrança digital de restaurante é criada atualmente.
- Definir comissões, repasses ao restaurante e remuneração do motoboy; há valores de pedido e registro do recebimento, mas não há conciliação nem pagamento de parceiros.
- Criar escalonamento quando ninguém aceita e tratamento de entrega sem motoboy. O aviso atual é um alerta de pedido pronto aos elegíveis; o entregador ainda consulta a lista atualizada periodicamente. O envio push depende de VAPID e da rotina de despacho existentes.
- Expandir cancelamentos após aceite, falhas após retirada, estornos e disputas com política financeira aprovada.
- Cupons de delivery, campanhas, promoções, agendamento, retirada no balcão, horários por dia e taxas por bairro.
- Homologar localização em aparelhos reais, funcionamento PWA instalado, permissões, mapas e perda de conexão; a ferramenta de navegador bloqueou por política de segurança a inspeção de `http://localhost:3010/delivery` e proibiu tentativas por outro método.
- Validar fluxo ponta a ponta com cliente, restaurante, motoboy e administrador em ambiente de testes Supabase após a aplicação das migrations.

## Verificações locais

- `npm run test:delivery`: passou (6 testes).
- `npm run test:rides`: passou (34 testes).
- `npm run test:regressions`: passou (56 testes).
- `npm run test:security`: passou (26 testes).
- `npx tsc --noEmit` e `npm run lint`: passaram após as últimas adições.
- `npm run build:vercel`: passou após as últimas adições; o build somente preparou o service worker local.
- A função SQL de checkout rejeita endereço sem latitude ou longitude. O teste de integração cobre a chamada direta à função.

Nenhuma migration foi executada no Supabase real e nenhuma publicação foi feita.
