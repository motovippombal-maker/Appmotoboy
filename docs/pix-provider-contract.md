# Integração futura de Pix

O Pix está indisponível para novas corridas. `getPixProvider()` falha de forma explícita mesmo que `PIX_PROVIDER` tenha sido preenchido; nenhuma credencial ou cobrança fictícia foi criada. O frontend mostra a indisponibilidade e `POST /api/rides/request` bloqueia Pix no servidor.

O domínio financeiro continua em `rides` e `payments` (um pagamento por corrida). A interface `PixProvider` em `lib/backend/payment.ts` define a criação de cobrança e a verificação de webhook. Um adaptador real deve ser homologado antes de ser selecionável: credenciais do provedor, criação e consulta de cobrança, expiração/cancelamento, reconciliação e testes ponta a ponta.

O endpoint futuro `POST /api/webhooks/pix` só pode processar eventos após `verifyWebhook` validar a assinatura/autenticidade. O processamento deve conferir identificador da cobrança, provedor, corrida, valor e transição de estado; deduplicar `eventId` em `payment_webhook_events`; e atualizar pagamento e evento numa única transação. Nunca aceitar `paid` vindo do passageiro ou confiar apenas no QR Code. Os estados previstos são `pending`, `paid`, `expired`, `cancelled`, `failed` e `refunded`.
