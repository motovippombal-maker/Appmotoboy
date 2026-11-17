# MotoPombal: Compras e entrega híbrida

## Base examinada

A implementação parte de `10a3255fb7f70e87b09572a61386cc9963e305d3`. O PWA já oferecia mototáxi e retirada de pedidos combinados fora da plataforma. O ajuste da central permitia rodízio e oferta simultânea; a distância ordenava marcadores no mapa, não a fila. O Pix já definia contratos de integração, mas não tinha adaptador funcional. Não foi fornecida imagem de referência acessível; as telas seguem a sequência descrita no pedido.

Foram reaproveitados Supabase Auth e os papéis existentes, as áreas de atendimento, a tarifa regional, o motor de ofertas/aceite, o GPS e os mapas. Compras usa pedido próprio e só cria a logística depois de a loja sinalizar que o pedido está pronto. O comprador pode ter uma corrida comum enquanto um pedido de Compras é preparado ou entregue. O entregador continua sujeito a uma única corrida/entrega ativa.

## Implementado no código

| Área | Caminho | Comportamento |
| --- | --- | --- |
| Cliente | Início → **Compras**, `/compras` | Busca lojas e filtra categorias, confirma endereço atendido, abre a loja por link e vê horário e situação. Catálogo consulta dados reais da loja aprovada. |
| Compra | `/compras/lojas/[slug]` | Configura opções e quantidades, confirma troca de loja, recebe cotação, confere o total e faz checkout em dinheiro. |
| Pedido | `/compras/pedidos` e `/compras/pedidos/[id]` | Acompanha preparação, busca do entregador, entrega, ocorrência e recebimento. Consulta tentativa anterior sem repetir o POST. |
| Comerciante | `/comerciante` | Edita loja, horário e abertura; gerencia catálogo, opções, preços e estoque; aceita/recusa, marca pronto e consulta pedidos e repasses. O acesso vem do vínculo com a loja, independentemente do papel global da conta. |
| Central | `/admin/marketplace` | Cadastra/aprova/suspende loja, define retirada e área, vincula responsáveis e entregador aprovado, consulta pedidos, registra exceções e pode intervir com histórico. |
| Entregador | Área do motorista e `/motorista/compras` | Aceita ou recusa, confirma chegada/retirada/entrega, consulta valor a cobrar e registra recebimento. O histórico de Compras permite registrar o recebimento mesmo após fechar a tela de conclusão. |

O checkout assina a cotação com HMAC, confere usuário, carrinho e endereço, recota catálogo e tarifa e exige nova confirmação quando mudam. O RPC revalida catálogo/estoque sob bloqueio e grava snapshots. A chave é única por cliente e vinculada ao conteúdo do pedido. Na ausência de resposta, o cliente consulta a mesma chave ou tenta de novo de forma explícita; não confirma compras offline. A reserva é feita no ato da compra e revertida quando um pedido elegível é cancelado ou expira. Em pedidos pendentes, o prazo de confirmação da loja é de 15 minutos.

Catálogo público passa por respostas com campos permitidos. Pedidos e dinheiro exigem sessão e escopo da conta; as tabelas têm RLS, e RPCs de escrita são restritos ao servidor. Os dados do destinatário e seu ponto exato ficam ocultos da oferta; o motorista vinculado recebe o necessário após aceitar. Respostas privadas usam `no-store` e as APIs ficam fora do cache PWA. Há trilha de evento/auditoria para alterações de gestão, pedido, entrega e dinheiro.

### Entrega

- Pedido pronto procura primeiro o preferencial elegível da loja e não aceita automaticamente. Recusa, expiração ou indisponibilidade levam à rede geral. O preferencial passa pelos controles de cadastro, turno, veículo e disponibilidade; sem GPS recente não é exibida uma distância para ele.
- Na rede geral, a distância usada é geográfica até a retirada. Critérios iniciais: GPS de até 75 s, precisão de até 100 m e até 15 km da loja; empate por ID. Isso não altera a tarifa regional nem constitui estimativa de tempo de chegada. A configuração fica em `system_settings.marketplace_dispatch`.
- Padrões de oferta, intervalo e limite: 30 s para responder, 60 s para tentar novamente sem candidato, até 20 tentativas. Pedido sem candidato permanece aguardando; após o limite, a central pode retomar a busca. Desistência antes da retirada devolve o pedido à busca. Após a retirada, a central trata a ocorrência mantendo a atribuição até resolver o caso.
- A aceitação e as transições logísticas são protegidas por verificações e bloqueios de banco. Compras não autoriza transição comercial ou confirmação financeira offline. O pacote local existente continua útil como referência de navegação.

### Dinheiro, GPS e limites de escopo

Entrega concluída não significa recebimento. O entregador registra o dinheiro que recebeu de fato; o responsável da loja confirma o repasse recebido depois. O valor dos produtos é da loja e o frete é separado. A plataforma tem campo contábil dedicado, com valor zero nesta implementação. Sem cobrança recorrente, comissão, bloqueio por inadimplência, integração de cartão ou Pix funcional. Para futuras assinaturas/contratos, ainda é necessário aprovar preços, responsáveis, período, confirmação do provedor e conciliação; o exemplo de R$ 150 não virou regra.

O GPS reutiliza o watcher, os filtros de qualidade, a fila de envio, a comparação de timestamps e os limites de recálculo já presentes. Amostras inválidas, antigas ou com timestamp indevidamente futuro não avançam a última posição. O cliente só vê o marcador do entregador enquanto houver dado recente, e um arrasto manual não é desfeito por um evento de redimensionamento. A posição é a recebida; não se inventa movimento, rota ou duração. No checkout, preparo informado e deslocamento estimado aparecem em campos separados.

Escopo inicial: uma loja por carrinho, venda por unidade/variações, operação em Ribeira do Pombal, dinheiro na entrega. Cupons de mototáxi/entrega avulsa permanecem no fluxo atual; não há cupom de Compras nesta versão. Imagens são exibidas sem proxy do servidor. O comerciante pode usar URL pública HTTPS validada ou enviar PNG, JPEG ou WebP de até 3 MiB, com verificação de tipo/assinatura e vinculação à loja. As fotos são públicas; não suba arquivos privados. Arquivos enviados e não utilizados podem permanecer no bucket para limpeza administrativa. Ainda não há avaliações de loja, substituições, venda por peso variável, multiloja, carrinho persistente entre sessões ou múltiplas cidades. As listas mostram registros recentes do primeiro lote; não há paginação histórica completa. Não há promessa de GPS contínuo com o PWA fechado ou tela bloqueada.

## Migrations e configuração pendente

Na entrega inicial, foram criados três arquivos incrementais sem editar migrations existentes. **Naquela entrega**, ainda não haviam sido executados:

1. `20261115120000_marketplace.sql` — lojas, vínculos, catálogo, pedidos/estoque, dinheiro, RLS e RPCs.
2. `20261115121000_marketplace_dispatch.sql` — integração com corridas, ofertas, concorrência por pedido/motorista, processamento e ocorrências.
3. `20261115133000_marketplace_management.sql` — gestão de loja, catálogo, responsáveis, auditoria e bucket público `marketplace-images` para leitura de fotos. Uploads são autorizados pela API; gravação direta de usuários é bloqueada.

Em ambiente de teste autorizado, confira antes o histórico do schema e os três arquivos de outubro requeridos pela base. A identidade por telefone deve estar disponível para autenticar. Faça backup e aplique os arquivos novos em ordem, primeiro em ambiente isolado. As áreas reais de origem/destino e as tarifas existentes precisam estar configuradas. O checkout e catálogo protegido dependem das variáveis Supabase do projeto; a área de Compras não atende pedidos antes das migrations. As leituras de corridas comuns têm compatibilidade quando o Postgres confirma que a coluna nova específica ainda não existe; erros de permissão ou outras falhas não ignoram o filtro de isolamento.

O lote de expiração e redistribuição deve ser chamado por um agendador externo confiável, idealmente a cada 15–30 segundos com os padrões iniciais (ajuste frequência ao ambiente). Configure um `MARKETPLACE_DISPATCH_SECRET` aleatório de pelo menos 32 caracteres, separado dos outros segredos. Faça `POST /api/internal/marketplace/dispatch` com `Authorization: Bearer …` em um agendador que suporte POST. Use HTTPS e não coloque o segredo em variável pública, URL ou log. O acionamento imediato ao marcar pronto/recusar reduz a latência, mas não substitui o agendamento. Agendador, ambiente Supabase e integrações externas não foram configurados.

Para recuperação, pause o agendador e confira pedidos/entregas vinculados antes de voltar código. Não remova índices, colunas ou tabelas se já houver compras: reverter o índice aqui exige verificar corridas simultâneas dos mesmos compradores, e remover tabelas destruiria históricos e valores. O caminho seguro após uso é preservar o banco e fazer correções incrementais; restauração depende de backup e autorização.

## Roteiro de homologação futura

1. Em banco isolado autorizado, aplique o histórico desde zero e valide também a atualização de uma cópia anterior. Configure polígonos/área e tarifas reais de teste; confira RLS com cliente, motorista, comerciante da loja A e comerciante da loja B.
2. Na central, crie uma loja de teste, cadastre um responsável real do ambiente e vincule um entregador aprovado. No painel da loja, crie categoria, produto, estoque limitado e um grupo obrigatório. Configure horários, abra a loja e confira o catálogo público.
3. No cliente, confirme endereço atendido, tente endereço externo e visite outra loja com carrinho preenchido. Teste opção obrigatória, indisponibilidade, alteração de preço entre cotação e confirmação, toque duplo e perda da resposta. Confirme estoque/reserva mediante duas conexões PostgreSQL concorrentes; ao cancelar/expirar, confira liberação única.
4. Peça mototáxi e faça uma compra em sessões separadas; confira que a compra em preparo não bloqueia o transporte. Ao marcar pronto, teste preferencial elegível, ocupado, offline, recusando e sem resposta. Na rede geral, varie distância à loja, GPS antigo, indisponibilidade e dois aceites/serviços concorrentes.
5. Em dois celulares, faça retirada e entrega com GPS em deslocamento; negue permissão, alterne Wi-Fi/dados, arraste o mapa, saia e retome a aba. Teste desistência antes da retirada e ocorrência depois dela. Conclua a entrega e confira saldo pendente até o recebimento e repasse manuais. O Pix deve continuar indisponível.

## Estado da validação desta entrega

| Comando/verificação | Resultado local |
| --- | --- |
| `tsx --test --test-concurrency=1` com os arquivos que não aplicam migrations | 148 testes aprovados; os 36 testes afetados pelos últimos ajustes também passaram em uma rodada direcionada. |
| `npm run lint` e ESLint direcionado após os últimos ajustes | Aprovados, sem avisos. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Aprovado após os builds. |
| `npm run build` | Build Vinext aprovado. |
| `node node_modules/next/dist/bin/next build --experimental-build-mode compile` | Compilação Next.js aprovada. O modo compile não inclui prerenderização. |
| `npm run check:vercel-env` | Build completo de publicação não validado: `.env.local` e as três configurações obrigatórias do Supabase não estavam presentes na cópia de validação. |

Os testes sem aplicação de SQL incluem testes puros de carrinho, GPS, tarifa e fluxos existentes, chamadas da API via Supabase simulado e verificações estáticas do despacho. Eles não comprovam criação/atualização de schema, RLS em execução ou corridas concorrentes. O script novo `npm run test:marketplace:db` prepara nove cenários em PGlite, incluindo isolamento, reserva e liberação, distribuição e dinheiro. Só foi feita verificação sintática do arquivo com `node --check`; a suíte ainda não foi executada. Esse script, `test:rides`, `test:tracking`, `test:financial`, `test:security`, `test:production` e `test:regressions` executam migrations em PGlite e ficaram fora desta execução a pedido. A validação multi-conexão, o cenário completo com banco real de teste e a homologação física continuam pendentes.

## Nova execução de auditoria — 15/11/2026

No mesmo checkout, com commit-base `10a3255` e Compras já presente nas alterações locais, a missão seguinte autorizou SQL somente em laboratório comprovadamente descartável. As três migrations acima passaram em PostgreSQL local 17.12 e PGlite nessa nova execução. As correções usam arquivos posteriores: `140000` (permissões e privacidade), `142000` (vínculo do GPS), `143000` (inscrições, avisos, validade e locks de despacho) e `144000` (ordem de locks do estoque na expiração). Nenhuma migration anterior foi reescrita.

A recuperação de checkout agora concilia o carrinho da tentativa e protege a troca de conta. Avisos confirmados de Compras alimentam a caixa do aplicativo; o processamento externo de Push depende da configuração e do agendador próprios. A bateria multi-conexão e as permissões locais não comprovam autenticação, Storage HTTP, Realtime ou operação com Supabase. Consulte [auditoria e resultados](AUDITORIA_MARKETPLACE.md), [ordem e evidência do banco](HOMOLOGACAO_SUPABASE.md) e [roteiro por perfil](HOMOLOGACAO_OPERACIONAL.md) antes de avaliar uma publicação. Nada foi publicado ou aplicado em ambiente remoto.

## Revisão financeira e preparação de publicação — 15/11/2026

A nova revisão acrescenta as migrations `145000` (valores declarados, divergências, repasse e histórico financeiro) e `146000` (Compras bloqueada para operação comercial, atestação reservada a laboratório). O valor esperado não é apresentado como caixa recebido. As 31 migrations passaram em PostgreSQL descartável, com instalação limpa, atualização preservando registros sintéticos e testes de concorrência. As três originais são as únicas que o responsável informou ter aplicado no projeto real; nenhum acesso remoto confirmou o histórico.

Leia [regras e resultados financeiros](REGRAS_FINANCEIRAS_MARKETPLACE.md) e [portão de publicação e ordem pendente](PUBLICACAO_MARKETPLACE.md). A revisão não publica, não habilita Pix/cartão e não ativa operação comercial real. `145000` exige o contrato novo de caixa; `146000` fecha Compras por padrão. Não aplique essas duas indiscriminadamente ao ambiente que serve clientes.

**Revisão posterior, antes da aplicação em produção:** o responsável confirmou que só faltam `145000` e `146000`. A antiga `146000_marketplace_test_only.sql` foi substituída por `146000_marketplace_operation_mode.sql` (mantido o timestamp completo). A nova versão separa produção real de testes e inicia fechada nos dois modos. Use o [roteiro de corte](PUBLICACAO_MARKETPLACE.md): app compatível primeiro, janela somente de Compras, `145000` → `146000`, abertura deliberada por último. SQL remoto, publicação e habilitação ainda não foram executados.

## Vitrine de lojas e Brasa da Vila — 16/11/2026

A vitrine de `/compras/lojas/[slug]` usa o cardápio e a disponibilidade de cada loja real, com capa, logo, etapas, busca e categorias em vermelho e branco. As operações de endereço, cotação e checkout continuam usando o fluxo existente de Compras.

A Brasa da Vila pode ser aberta pelo cartão de demonstração em Compras ou pela rota `/compras/demonstracao/brasa-da-vila`. O catálogo ilustrativo, suas opções e as imagens WebP são locais. O carrinho e a revisão da simulação existem apenas na memória da página: não se misturam ao carrinho comercial, não gravam nem enviam pedidos e não calculam frete ou cobram. O servidor D1/SQLite e o login do projeto independente do ZIP não fazem parte do app. Nenhum endereço, prazo ou preço fictício foi cadastrado como loja real; esta revisão não exige migration.
