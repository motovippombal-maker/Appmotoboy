const ACCOUNT_SLOT_KEY = "moto-syxp:account-slot";
const UUID_SLOT = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type TabStorage = Pick<Storage, "getItem" | "setItem">;

function validSlot(value: string | null): value is string {
  return value === "2" || (value !== null && UUID_SLOT.test(value));
}

export function legacyAuthStorageKey(supabaseUrl: string) {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

// A window gets its own auth namespace even when it opens the ordinary site URL.
// sessionStorage keeps that namespace across reloads and navigation in this window.
export function browserAuthStorageKey(
  supabaseUrl: string,
  search: string,
  tabStorage: TabStorage,
  createSlot: () => string = () => crypto.randomUUID(),
) {
  const requested = new URLSearchParams(search).get("conta");
  const existing = tabStorage.getItem(ACCOUNT_SLOT_KEY);
  const slot = validSlot(requested) ? requested.toLowerCase()
    : validSlot(existing) && requested !== "1" ? existing
      : createSlot();
  tabStorage.setItem(ACCOUNT_SLOT_KEY, slot);
  return `${legacyAuthStorageKey(supabaseUrl)}-conta-${slot}`;
}

export function replaceAccountSlot(tabStorage: TabStorage, createSlot: () => string = () => crypto.randomUUID()) {
  const slot = createSlot();
  tabStorage.setItem(ACCOUNT_SLOT_KEY, slot);
  return slot;
}
