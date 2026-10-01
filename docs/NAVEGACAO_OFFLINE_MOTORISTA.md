# Navegação offline do motorista

## Entrega de 2026-10-01

Após aceitar uma corrida, o aplicativo prepara as rotas até o embarque e até o destino e salva os dados mínimos da viagem no IndexedDB. O pacote local da região de Ribeira do Pombal contém ruas dirigíveis, nomes de vias e alguns pontos de referência. Ele é obtido antes da perda de rede, verificado por SHA-256 e mantido no Cache API. O mapa local usa esses dados, sem tentar baixar mosaicos do servidor público do OpenStreetMap.

O GPS do aparelho continua sendo lido sem depender da conexão. Quando a rota salva deixa de servir, um grafo local calcula outra rota dentro da região coberta. Chegada, início e conclusão são registrados primeiro no aparelho, em ordem, com ID, horário e coordenadas disponíveis. A sincronização compara cada etapa com o estado do servidor e não repete uma transição já confirmada. Uma corrida ativa pode ser recuperada após fechar e reabrir o PWA, desde que a sessão local e os dados do navegador continuem presentes.

O indicador de rede usa verificações de saúde do backend com estados ONLINE, DEGRADED, OFFLINE e RECOVERING. A tela sinaliza quando há etapas pendentes e quando a corrida foi concluída apenas no aparelho. O pagamento permanece pendente até a confirmação do servidor.

## Limites e cuidados

- Cobertura: somente o retângulo definido em `lib/offline/region.ts`. Fora dele, ou se uma ponta da rota estiver distante da malha, o aplicativo informa que a cobertura offline está incompleta.
- A rota local respeita sentidos únicos cadastrados, mas não inclui todas as restrições de conversão, interdições em tempo real, tráfego ou velocidades por via. A duração local é uma estimativa; o motorista deve respeitar a sinalização da rua.
- A distância efetivamente percorrida não é comprovada por uma trilha GPS persistida. Corridas de tarifa variável concluídas offline ficam para conferência da central e não são finalizadas automaticamente no servidor. Para tarifa fixa regional, a distância efetiva é marcada como não verificada.
- O navegador pode limpar Cache API, IndexedDB ou sessão; isso remove a capacidade de recuperação. Instalação do PWA e um carregamento online completo antes da viagem são necessários para reabrir offline.
- A validação automatizada não substitui teste em aparelho real, com modo avião, GPS ligado, fechamento do app e reconexão.

## Verificação em aparelho

1. Instalar o PWA e entrar como motorista em Ribeira do Pombal.
2. Abrir o app online e confirmar no painel que o mapa regional está pronto.
3. Aceitar uma corrida inteiramente dentro da cobertura e verificar as duas rotas preparadas.
4. Ativar o modo avião mantendo a localização do aparelho ligada. Confirmar que ruas, posição, rota e instruções continuam visíveis.
5. Sair da rota, verificar o novo traçado local, marcar chegada e início e fechar o PWA.
6. Reabrir ainda sem rede; confirmar corrida e etapas locais. Concluir a corrida e conferir aviso de sincronização pendente.
7. Restaurar a rede; verificar cada status, horário e histórico no servidor. Confirmar que a corrida não é duplicada.
8. Repetir com GPS temporariamente indisponível, rota fora da cobertura e tarifa variável; nesses casos a interface deve mostrar limites e não inventar distância ou pagamento confirmado.

## Dados e atualização

O pacote regional é gerado por `scripts/build-offline-region.mjs` a partir de dados OpenStreetMap, sob ODbL. Ao regenerar, atualizar versão e checksum em `lib/offline/region.ts`, testar o grafo e publicar o novo arquivo com o aplicativo. A interface exibe a atribuição © OpenStreetMap contributors.
