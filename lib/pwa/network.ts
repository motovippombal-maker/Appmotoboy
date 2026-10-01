export function assertOnlineConnection(online: boolean) {
  if (!online) throw new Error("Sem conexão. Reconecte-se antes de continuar.");
}
