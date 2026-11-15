# Auditoria da expansão para restaurantes

## Estado encontrado em 21/10/2026

- Next.js 16/React 19/TypeScript, Supabase Auth e PostgreSQL; aplicação única em `app/page.tsx`.
- Papéis existentes: `passenger`, `driver`, `admin`. Um proprietário de restaurante precisa de vínculo adicional, não de novo login ou alteração do papel principal.
- Corridas, ofertas, localização, tarifas regionais, Pix para corridas, cupons de corrida, notificações, painel administrativo e PWA já existem.
- `rides.service_type` já aceita entregas avulsas. Isso representa frete entre endereços e não pedidos de um cardápio. O fluxo de restaurante fica em tabelas próprias.
- `drivers.available` é usado pelo despacho de corridas; atribuir uma entrega de restaurante deve travar a mesma linha do motorista e impedir simultaneidade nas duas direções.
- Endereços favoritos atuais vivem no armazenamento do aparelho. Para checkout, o pedido precisa guardar um retrato do endereço confirmado no banco.
- O aplicativo usa cliente Supabase no navegador e APIs com `requireUser`, `requireAdmin`, `audit` e RPCs atômicas. O delivery segue as mesmas convenções.

## Sequência de integração

1. Migration aditiva: restaurantes, menu, personalização, configuração de frete, pedidos, eventos, preferências de motorista, RLS e RPCs atômicas.
2. APIs para catálogo, administração, restaurante, cotação, criação e evolução dos pedidos, e atribuição de motoboy.
3. Telas do cliente, restaurante, motorista e administrador no mesmo PWA e com a sessão existente.
4. Validar tipos, lint, testes de regras e regressões de corridas. Aplicar migration e homologar o fluxo em ambiente de testes antes da produção.

## Limites de ativação

- O frete de restaurante começa desabilitado, sem valor inventado. A operação deve configurar os valores e ativá-lo.
- Pagamento online requer provedor e credenciais reais. Dinheiro/cartão na entrega podem gerar pedido, mas conciliação financeira precisa de procedimento operacional explícito.
- Migration não é aplicada automaticamente. Até sua aplicação, as novas rotas apresentam erro de configuração, sem simular pedidos.
