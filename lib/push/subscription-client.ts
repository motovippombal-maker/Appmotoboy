export const PUSH_OWNER_KEY = "moto-syxp:push-owner";

export async function retirePushSubscription(
  subscription: { endpoint: string; unsubscribe: () => Promise<boolean> },
  deactivate: (endpoint: string) => Promise<void>,
) {
  let serverDeactivated = false;
  let browserUnsubscribed = false;
  try {
    await deactivate(subscription.endpoint);
    serverDeactivated = true;
  } catch {
    // A inscrição local ainda deve ser encerrada quando o servidor estiver indisponível.
  }
  try {
    browserUnsubscribed = await subscription.unsubscribe();
  } catch {
    // O logout só prossegue se pelo menos um dos dois lados foi limpo.
  }
  return serverDeactivated || browserUnsubscribed;
}

export async function discardSubscriptionFromAnotherUser(
  ownerId: string | null,
  currentUserId: string,
  subscription: { unsubscribe: () => Promise<boolean> } | null,
) {
  if (!subscription || ownerId === currentUserId) return true;
  return subscription.unsubscribe();
}
