# Auditoria crítica do motorista — 01/10/2026

## Estado da entrega

Correções implementadas no checkout local e verificadas por testes automatizados. O usuário informou que o editor SQL retornou “Success. No rows returned” após a execução manual; ainda não foi possível confirmar que o projeto usado é o mesmo configurado no aplicativo. A migração também passou no PostgreSQL em memória dos testes (PGlite), inclusive numa segunda execução. Esta versão **não foi publicada**. A homologação em dois aparelhos reais segue pendente. A taxa de cancelamento começa desativada.

## Causas encontradas

1. **Motorista preso após cancelamento:** `/api/rides/active` excluía corridas canceladas; o pacote IndexedDB podia então ser escolhido como corrida ativa, mesmo depois de o banco encerrá-la. A sincronização offline não descartava o pacote ao encontrar cancelamento. Este é um defeito confirmado pela leitura do fluxo e coberto por novos testes.
2. **GPS após aceitar:** o efeito que instala `watchPosition` era acoplado ao ID da corrida; a mudança de ID no aceite causava limpeza e nova inscrição do watcher. A inscrição agora acompanha apenas a condição de funcionamento e lê o ID atual por referência. Isso remove a interrupção identificada no código; o desaparecimento relatado não foi reproduzido em aparelho real nesta auditoria.
3. **Mapa vazio/cinza:** motorista e passageiro usam `RealMap`, mas a navegação do motorista exige tiles, tamanho atualizado do contêiner e rota em tempo real. O componente atual possui alternância de tiles, `ResizeObserver`/`invalidateSize`, camada local e mantém marcador de GPS quando o roteamento falha. Não há captura de falha HTTP/CORS do aparelho afetado; portanto não é possível atribuir um único provedor ou erro de rede como causa definitiva do mapa cinza.
4. **Tela “This page couldn’t load”:** o service worker atual não guarda APIs privadas, guarda o shell e chunks estáticos iniciais e usa fallback ao abrir sem rede. O teste de instalação foi corrigido para simular a resposta HTML real e passou. Não foi obtido o log do navegador que causou a tela preta no aparelho.

## Alterações técnicas

- **Autoridade do servidor:** `/api/rides/active` informa o último cancelamento do motorista. O seletor de corrida não deixa eventos locais sobrescreverem um snapshot confirmado; o evento de cancelamento limpa a corrida mesmo durante degradação de rede. O pacote offline é descartado ao confirmar o cancelamento. Um fallback consulta o estado da corrida a cada 5 segundos enquanto ela está ativa e consulta novamente na reconexão/foco.
- **Realtime:** atualização `rides.status = cancelada` interrompe imediatamente a corrida ativa no cliente; as inscrições são removidas no cleanup do hook. A consulta ao servidor cobre eventos perdidos. A troca de ID da corrida não reinicia o watcher de GPS.
- **GPS, rota e mapa:** GPS e rota permanecem estados separados. O watcher continua enviando posições depois do aceite; falha de rota mantém posição, mapa e rota local disponível. Há diagnóstico de tiles em desenvolvimento e fallback de camada.
- **Máquina de estados:** as transições continuam validadas no servidor pelo gatilho existente e pelas RPCs `accept_ride`, `start_ride`, `finish_ride` e `cancel_ride`. `no_show` é um código terminal distinto registrado numa corrida cujo status persistido é `cancelada`.
- **Chegada:** botão e API usam raio configurável. A API exige localização da corrida, precisão de até 40 m e atualização de até 30 s. O tempo de no-show começa pelo horário de confirmação no servidor; um carimbo offline anterior não antecipa o prazo.
- **Cancelamento e fila:** a nova RPC registra ator, motivo, evidências GPS, taxa avaliada e código terminal; expira ofertas, libera o motorista e desvincula localizações. A posição de despacho anterior ao aceite é restaurada no cancelamento pelo passageiro quando a política permite. Cancelamento durante `em_corrida` continua proibido.
- **Taxa:** política editável no ADM: ativação, tolerância, deslocamento mínimo, valores, raio de chegada, espera e prioridade da fila. O padrão é taxa desativada, tolerância de 120 s, deslocamento de 250 m, raio de 130 m e espera de 300 s. A taxa só é avaliada com múltiplos pontos recentes e deslocamento plausível ou chegada verificada. A avaliação fica no registro da corrida e auditoria; **a cobrança/recebimento da taxa não foi conectada ao fluxo financeiro**.
- **Supabase:** migração `20261001190000_driver_ride_cancellation_audit.sql` adiciona campos de evidência e prioridade, pontos de aproximação com acesso restrito e a RPC revisada. Ela foi executada em PGlite e o usuário relatou sucesso no editor SQL remoto; a identidade e o schema do projeto remoto ainda não foram verificados por esta auditoria.

## Arquivos centrais

`app/page.tsx`, `hooks/use-moto-vip.ts`, `app/api/rides/active/route.ts`, `app/api/rides/[id]/transition/route.ts`, `app/api/location/route.ts`, `app/api/admin/cancellation/route.ts`, `app/api/admin/rides/route.ts`, `components/admin/operations-panel.tsx`, `lib/driver/ride-authority.ts`, `lib/offline/ride-sync.ts`, `lib/offline/ride-store.ts`, `lib/backend/cancellation-policy.ts`, `supabase/migrations/20261001190000_driver_ride_cancellation_audit.sql` e testes correspondentes. O checkout já continha outras alterações anteriores não consolidadas; esta auditoria não as publicou.

## Testes do roteiro solicitado

| Nº | Cenário | Evidência automatizada | Aparelhos reais |
| --- | --- | --- | --- |
| 01 | Cancela antes do aceite | PGlite: oferta expira; aceite negado | Pendente |
| 02 | Cancela logo após aceite | PGlite: liberação; taxa zero na tolerância | Pendente |
| 03 | Cancela a caminho | PGlite e teste do pacote offline | Pendente |
| 04 | Cancela perto | Política/evidência testada parcialmente | Pendente |
| 05 | Cancela após chegada | Regra da RPC e chegada verificada inspecionadas | Pendente |
| 06 | GPS persiste após aceite | Dependências e referência do watcher revisadas | Pendente |
| 07 | Rota até embarque | Serviço de rota e fallback testados | Pendente |
| 08 | Internet cai | Conectividade e pacote local testados | Pendente |
| 09 | Internet retorna | Sincronização e autoridade do servidor testadas | Pendente |
| 10 | Realtime cai/reconecta | Estado e fallback testados | Pendente |
| 11 | Fecha e reabre | Seleção de corrida/paquete testada parcialmente | Pendente |
| 12 | No-show | PGlite: prazo mínimo e código terminal | Pendente |
| 13 | Rota troca para destino | Fase de rastreamento testada | Pendente |
| 14 | Finaliza e volta à fila | PGlite: disponível e fila `queued` | Pendente |
| 15 | Passageiro + motorista em dois aparelhos | Não executado | Pendente |

Suítes executadas com sucesso: `test:rides` (23), `test:offline` (11), `test:driver` (10), `test:tracking` (16), `test:location` (18), `test:security` (25), `test:financial` (20) e `test:production` (27), total de **150 testes aprovados**. `tsc --noEmit`, lint (sem erros, um aviso antigo de componente não usado) e `build:vercel` passaram. O build local ainda alerta configuração ausente para Pix/Push e URL pública.

## Pendências antes de publicar e homologar

1. Confirmar que a execução manual ocorreu no projeto Supabase configurado para o aplicativo e verificar colunas, política e permissões. As tentativas de conexão direta pelo terminal falharam por TLS/rede; a conta aberta no navegador não tem acesso a esse projeto.
2. Validar em dois celulares o fluxo completo, cancelamento em cada fase, alternância Wi‑Fi/4G, app fechado/reaberto, precisão GPS e erro de tiles/rota, com logs reais.
3. Conectar e homologar a cobrança da taxa no financeiro antes de ativá-la no ADM. Até lá, ela é apenas avaliação auditável e permanece desativada por padrão.
4. Confirmar desempenho do mapa e do pacote offline em celulares simples e capturar a causa de qualquer nova tela “This page couldn’t load”.

**Conclusão:** o defeito de corrida fantasma foi corrigido em código e reproduzido em testes. O sistema ainda não está homologado para publicação desta mudança.
