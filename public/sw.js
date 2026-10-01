const SHELL_CACHE = "moto-pombal-shell-v11";
const STATIC_CACHE = "moto-pombal-static-v11";
const REGION_CACHE = "moto-pombal-region-packages";
const SHELL_ASSETS = [
  "/",
  "/offline.html",
  "/manifest.webmanifest",
  "/icons/moto-pombal-192.png",
  "/icons/moto-pombal-512.png",
  "/icons/moto-pombal-maskable-512.png",
  "/icons/apple-touch-icon.png",
  "/brand/motopombal-wordmark.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const shellCache = await caches.open(SHELL_CACHE);
      await Promise.allSettled(SHELL_ASSETS.map(async (path) => {
        const response = await fetch(path, { cache: "no-cache", signal: AbortSignal.timeout(8_000) });
        if (response.ok) await shellCache.put(path, response);
      }));
      // A primeira visita ocorre antes de o SW controlar a página. Guarde os
      // chunks do HTML inicial para que a próxima abertura não dependa da rede.
      const shell = await shellCache.match("/");
      if (shell && typeof shell.text === "function") {
        const html = await shell.text();
        const paths = [...new Set([...html.matchAll(/(?:src|href)="([^"\s]*\/_next\/static\/[^"\s]+)"/g)]
          .map((match) => match[1].replaceAll("&amp;", "&"))
          .filter((path) => path.startsWith("/_next/static/")))];
        const staticCache = await caches.open(STATIC_CACHE);
        await Promise.allSettled(paths.map(async (path) => {
          const response = await fetch(path, { signal: AbortSignal.timeout(8_000) });
          if (response.ok) await staticCache.put(path, response);
        }));
      }
      await self.skipWaiting();
    })(),
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
              .filter((key) => {
                if (key === SHELL_CACHE || key === STATIC_CACHE || key === REGION_CACHE) return false;
                // Uma aba já aberta pode precisar de chunks da versão anterior.
                const staticVersion = /^moto-pombal-static-v(\d+)$/.exec(key);
                if (staticVersion && Number(staticVersion[1]) >= 10) return false;
                return key.startsWith("moto-syxp-") || key.startsWith("moto-vip-") || key.startsWith("moto-pombal-");
              })
              .map((key) => caches.delete(key)),
          ),
        ),
      self.clients.claim(),
    ]),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
  if (event.data?.type === "CLOSE_RIDE_OFFER") {
    event.waitUntil(
      self.registration.getNotifications({ tag: `ride-offer:${event.data.rideId}` })
        .then((notifications) => notifications.forEach((notification) => notification.close())),
    );
  }
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);

  // APIs, Supabase e respostas autenticadas permanecem sempre na rede.
  // Dados privados da corrida ficam apenas no IndexedDB local.
  if (
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    request.headers.has("authorization")
  )
    return;

  if (request.mode === "navigate") {
    event.respondWith((async () => {
      try {
        const response = await fetch(request, { signal: AbortSignal.timeout(10_000) });
        if (response.ok || response.status < 500) return response;
        return (await caches.match("/")) || (await caches.match("/offline.html")) || response;
      } catch {
        return (await caches.match("/")) || (await caches.match("/offline.html")) || Response.error();
      }
    })());
    return;
  }

  if (url.pathname.startsWith("/offline/") && url.pathname.endsWith(".json")) {
    event.respondWith(caches.open(REGION_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      if (cached) return cached;
      const response = await fetch(request);
      if (response.ok) await cache.put(request, response.clone());
      return response;
    }));
    return;
  }

  const isStaticAsset =
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/assets/") ||
    url.pathname.startsWith("/icons/") ||
    SHELL_ASSETS.includes(url.pathname);
  if (!isStaticAsset) return;
  event.respondWith(
    caches.open(STATIC_CACHE).then(async (cache) => {
      const cached = await caches.match(request);
      try {
        const response = await fetch(request);
        if (!response.ok && cached) return cached;
        const cacheControl = response.headers.get("cache-control") || "";
        if (
          response.ok && response.type === "basic" &&
          !/(?:no-store|private|no-cache)/i.test(cacheControl) &&
          !response.headers.has("set-cookie")
        )
          void cache.put(request, response.clone());
        return response;
      } catch {
        return cached || Response.error();
      }
    }),
  );
});

self.addEventListener("push", (event) => {
  let payload = {
    title: "MotoPombal",
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
    self.registration.showNotification(payload.title || "MotoPombal", {
      body: payload.body,
      icon: "/icons/moto-pombal-192.png",
      badge: "/icons/moto-pombal-192.png",
      tag: payload.data?.type === "ride.offer" && payload.data?.rideId
        ? `ride-offer:${payload.data.rideId}`
        : payload.data?.notificationId || undefined,
      renotify: payload.data?.type === "ride.offer",
      requireInteraction: payload.data?.type === "ride.offer",
      vibrate: payload.data?.type === "ride.offer" ? [450, 160, 450, 160, 700] : [180],
      data: payload.data || {},
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  // Nunca navega para uma URL arbitrária recebida no Push.
  const notificationData = event.notification.data || {};
  const target = notificationData.type === "ride.offer" && notificationData.rideId
    ? `/?open=driver-offer&ride=${encodeURIComponent(String(notificationData.rideId))}`
    : typeof notificationData.type === "string" && notificationData.type.startsWith("queue.")
      ? "/?open=driver-queue"
    : "/?open=notifications";
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
