# Moto SyXp — relatório de homologação da Etapa 10

Data: 29/09/2026. **Decisão técnica: NO-GO.** Este é um relatório parcial de evidências, não uma homologação física concluída nem uma autorização para publicar.

## Ambiente e identidade dos testes

| Item | Evidência |
| --- | --- |
| Ambiente efetivamente usado | Checkout local em Windows/PowerShell; Node.js 24.14.0 e npm 11.9.0. Builds locais Next/Vercel e Vinext. |
| Banco usado pelos testes | PGlite isolado em memória. Nenhuma conexão de homologação PostgreSQL/Supabase foi usada. |
| Supabase e URL HTTPS exclusivos de homologação | **Não existem ainda**, conforme informado pelo responsável nesta etapa. O `.env.local` não foi tratado como staging. |
| Acesso ao painel externo | Não houve acesso. A tentativa de inventário de navegador falhou na inicialização do helper por erro de ACL do sandbox; nenhuma configuração externa foi alterada. |
| Aparelhos | Dois Android informados como disponíveis, **não utilizados** nesta execução. Modelos, versões do Android e navegadores ainda não registrados. iPhone não informado. |
| Contas de teste | Nenhuma criada. Passageiro, motoristas A/B, administrador, bloqueado e não aprovado: **não testados fisicamente**. |
| Credenciais e dados | Nenhum segredo foi impresso, inventado, reutilizado para staging ou enviado a terceiros. Nenhum cliente ou pagamento real foi usado. |

## Verificações automatizadas executadas

| Verificação | Resultado |
| --- | --- |
| Etapas 2–9 | **132/132 aprovados**: 7 + 10 + 12 + 15 + 18 + 20 + 25 + 25. |
| ESLint | Aprovado, zero erros. |
| TypeScript | Aprovado, zero erros. |
| Build Vinext | Aprovado. Avisos não bloqueantes de resolução de imagens padrão do Leaflet e classificação estática de rotas. |
| Build Next/Vercel | Aprovado localmente, inclusive TypeScript interno. O verificador avisa que URL final, VAPID/Push e Pix ainda não estão configurados. |
| 13 migrations desde zero | Aprovadas **apenas em PGlite isolado**, em ordem, com Etapa 7 antes da Etapa 8. Não equivale a PostgreSQL/Supabase real. |
| Bundle público | Testes locais não encontraram valores privados conhecidos no bundle cliente gerado. |

Nenhuma falha automatizada foi escondida ou desabilitada. Não foram adicionados `any`, `@ts-ignore` nem funcionalidades nesta etapa.

## Matriz final

Legenda: **APROVADO** indica somente o escopo explicitamente testado; **PENDENTE** exige infraestrutura, configuração ou ação externa; **NÃO TESTADO** indica ausência de execução física/real. Nenhum fluxo físico abaixo deve ser interpretado como aprovado pelos testes automatizados.

| Funcionalidade | Automatizado | Teste físico / PostgreSQL real | Resultado | Pendência |
| --- | --- | --- | --- | --- |
| 13 migrations, constraints, funções, triggers, RLS, grants, publications e SECURITY DEFINER | PGlite: aprovado | Não testado | PENDENTE | Supabase **separado** de homologação; aplicar desde zero somente ali. |
| Concorrência multi-conexão: aceite, último cupom, dinheiro, localização, cancelamento e transições | Casos isolados: aprovados | Não testado | PENDENTE | PostgreSQL real e conexões independentes. |
| Cadastro, login, logout, persistência e recuperação de senha do passageiro | Parcial | Não testado | NÃO TESTADO | Conta e Auth de staging; SMTP de teste se disponível. |
| Cadastro de motorista, veículo e impedimento antes da aprovação | Parcial | Não testado | NÃO TESTADO | Contas de motorista de staging. |
| Aprovação, auditoria e mudança de estado pelo administrador | Parcial | Não testado | NÃO TESTADO | Admin de staging e dois aparelhos. |
| Motorista online e disponibilidade visível ao passageiro sem reload | Parcial | Não testado | NÃO TESTADO | Realtime de staging e dois aparelhos. |
| GPS: permitir, negar, retentar, precisão e seleção manual | Parcial | Não testado | NÃO TESTADO | Android físico; registrar aparelho e navegador. |
| Reverse geocoding preserva o ponto real | Aprovado em teste | Não testado | PENDENTE | Confirmar no aparelho. |
| Busca manual: rua, número, aproximação e não encontrado | Aprovado em teste | Não testado | PENDENTE | Confirmar no aparelho e serviço permitido. |
| Área de atendimento, dentro/fora e regiões especiais | Aprovado com polígonos de teste | Não testado | PENDENTE | Polígono **real de homologação**; não inventar coordenadas. |
| Cotação, persistência e resistência à adulteração de preço | Aprovado em teste | Não testado | PENDENTE | Corrida em staging. |
| Solicitação, busca, oferta, aceite, recusa e expiração real | Aprovado em teste | Não testado | PENDENTE | Fluxo entre passageiro e motoristas físicos. |
| Dois motoristas aceitando a mesma corrida | Simulação/PGlite: aprovado | Não testado | PENDENTE | Dois motoristas e concorrência PostgreSQL real. |
| Marcador, tracking, ETA, distância e zoom manual | Aprovado em teste | Não testado | PENDENTE | Corrida física; verificar ETA motorista→embarque e viagem→destino. |
| Navegação externa antes/depois do embarque | Parcial | Não testado | NÃO TESTADO | Aparelho do motorista. |
| Chegada, início, finalização e limpeza de tracking | Aprovado em teste | Não testado | PENDENTE | Dois aparelhos e banco staging. |
| Dinheiro: pendente→recebido e repetição idempotente | Aprovado em teste | Não testado | PENDENTE | Corrida de teste, sem dinheiro real. |
| Histórico mobile, detalhes, voltar, scroll e barra inferior | Aprovado em teste | Não testado | PENDENTE | Dois tamanhos de Android. |
| Notificações internas, Realtime e ausência de duplicidade | Aprovado em teste | Não testado | PENDENTE | Eventos de staging em aparelhos. |
| Offline, retorno da conexão, queda de Realtime e reinício durante corrida | Aprovado em teste isolado | Não testado | PENDENTE | Interrupções controladas nos aparelhos; conferir backend real. |
| Cancelamentos por passageiro e motorista | Aprovado em teste | Não testado | PENDENTE | Corridas distintas de staging. |
| Cupom parcial, integral e último uso concorrente | Aprovado em PGlite | Não testado | PENDENTE | Cupom de teste e PostgreSQL multi-conexão. |
| Segurança por papel, acesso admin, RLS, alteração de tarifa/ganho e pagamento alheio | Aprovado em testes isolados | Não testado | PENDENTE | Contas reais **de teste** e Supabase staging. |
| Usuário bloqueado e troca relevante de veículo | Aprovado em teste | Não testado | PENDENTE | Teste com admin e motorista de staging. |
| Painel admin: dashboard, corridas, motoristas, tarifas, regiões, pontos e financeiro | Parcial | Não testado | NÃO TESTADO | Admin de staging; testar cada menu. |
| Mapa admin e restrição para passageiro | Aprovado em teste | Não testado | PENDENTE | Motoristas online recentes em staging. |
| PWA: instalação, ícone, splash, abertura, offline e atualização de segunda versão | Requisitos técnicos: aprovados | Não testado | PENDENTE | URL HTTPS staging e instalação física; segunda versão **somente** em staging. |
| Push: VAPID, permissão, recebimento, toque e endpoint expirado | Segurança/configuração ausente: aprovada | Não testado | PENDENTE | VAPID e despachante exclusivos de staging, ou registrar Push não homologado. |
| Segundo plano, tela bloqueada e retorno | Não há garantia automatizada de GPS contínuo | Não testado | NÃO TESTADO | Medir e registrar limitação real, sem prometer background GPS. |
| Responsividade: celular pequeno, maior e desktop | Testes de layout parciais | Não testado | NÃO TESTADO | Modelos/navegadores e desktop. |
| Carga leve no backend próprio e logs sem dados sensíveis | Não testado | Não testado | NÃO TESTADO | Staging isolado; jamais gerar carga em Nominatim, Photon ou OSRM públicos. |
| Pix sem provedor homologado | Bloqueio frontend/backend: aprovado | Não testado | PENDENTE | Confirmar bloqueio em staging; Pix deve permanecer desabilitado. |
| Rotação/revogação da antiga chave administrativa | Não verificável localmente | Não testado | PENDENTE | Verificação operacional sem expor chave. |
| SMTP/Auth e entrega de e-mail | Não testado | Não testado | PENDENTE | SMTP de teste e Auth staging. |

## Critério objetivo e decisão

**NO-GO para publicação.** Não há falha automatizada bloqueante conhecida, mas os seguintes critérios obrigatórios **não foram comprovados**: migrations no Supabase/PostgreSQL de homologação, concorrência multi-conexão, lifecycle passageiro↔motorista em aparelhos, GPS físico, dinheiro em fluxo real de teste, segurança com contas de staging, instalação PWA e rotação/verificação da credencial administrativa antiga. A configuração obrigatória de produção também não está definida. Pix está bloqueado no código, mas o bloqueio físico em staging ainda não foi observado.

Pendências não bloqueantes isoladamente: Push físico se o lançamento for explicitamente sem Push; SMTP de teste se nenhum fluxo de e-mail for exigido no escopo da publicação; comportamento de GPS em segundo plano deve ser documentado como limitação. Essas condições **não** dispensam os critérios obrigatórios acima.

## Próxima janela de homologação

1. Criar um projeto Supabase exclusivo de homologação e uma URL HTTPS de staging, com credenciais próprias guardadas localmente em cofre/variáveis de ambiente. Não reutilizar o `.env.local` atual sem comprovar que é staging.
2. Registrar backup/base vazia e aplicar as 13 migrations em ordem **somente no staging**; verificar RLS, grants, publications e Realtime, sem reaplicar cegamente.
3. Preparar contas de teste por papel e polígono real de atendimento de homologação. Registrar modelo, Android e navegador de cada aparelho.
4. Executar o roteiro físico dos itens acima, guardar evidências sanitizadas e classificar cada linha como APROVADO, REPROVADO, PENDENTE ou NÃO TESTADO.
5. Reavaliar GO/NO-GO sem alterar os critérios. Publicação de produção permanece decisão separada.

Nenhum deploy de produção, migration em produção, mudança de DNS, Push real, Pix real, criação de cliente real ou alteração destrutiva de banco foi executado nesta etapa.
