const SHELL_CACHE = "moto-syxp-shell-v5";
const STATIC_CACHE = "moto-syxp-static-v5";
const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon-brand.svg",
  "/icons/moto-syxp-192.png",
  "/icons/moto-syxp-512.png",
  "/icons/moto-syxp-maskable-512.png",
  "/icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) => cache.addAll(SHELL_ASSETS)),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.all([
      caches
        .keys()
        .then((keys) =>
          Promise.all(
            keys
              .filter((key) => ![SHELL_CACHE, STATIC_CACHE].includes(key))
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // APIs, Supabase, mapas e respostas autenticadas permanecem sempre na rede.
  // Nenhum dado de corrida, sessao, localizacao ou pagamento entra no Cache API.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("authorization")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline.html")),
    );
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/assets/") ||
    /\.(?:css|js|woff2?|png|svg|ico)$/.test(url.pathname);
  if (!isStaticAsset) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      try {
        const response = await fetch(request);
        if (
          response.ok &&
          response.type === "basic" &&
          response.headers.get("cache-control") !== "no-store"
        )
          void cache.put(request, response.clone());
        return response;
      } catch {
        return (await cache.match(request)) || Response.error();
      }
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "Moto SyXp",
    body: "Você recebeu uma atualização.",
    data: {},
  };
  if (event.data) {
    try {
      payload = { ...payload, ...event.data.json() };
    } catch {
      payload.body = event.data.text() || payload.body;
    }
  }
  event.waitUntil(
    self.registration.showNotification(payload.title || "Moto SyXp", {
      body: payload.body,
      icon: "/icons/moto-syxp-192.png",
      badge: "/icons/moto-syxp-192.png",
      tag: payload.data?.notificationId || undefined,
      data: payload.data || {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  let target = "/";
  try {
    const requested = new URL(
      event.notification.data?.url || "/",
      self.location.origin,
    );
    if (requested.origin === self.location.origin)
      target = requested.pathname + requested.search + requested.hash;
  } catch {}
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windows) => {
        const existing = windows[0];
        if (existing) {
          if ("navigate" in existing) await existing.navigate(target);
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});
