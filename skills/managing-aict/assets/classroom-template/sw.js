/* AITCW classroom — push service worker.
 * Scope "/" (served from the site root). Its only job is to turn a push
 * message (POST /api/release, or the /me test button) into a system
 * notification and, on click, open the page it names — the released
 * version's board — in an existing classroom tab or a new one. No caching,
 * no offline behaviour. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "New feedback";
  const body = data.body || "Your instructor sent you feedback.";
  const url = data.url || "/me";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      data: { url: url },
      tag: data.tag || "aict-feedback",
      renotify: true,
      // Stay on screen until dismissed: on Windows a plain toast slides into
      // the Action Center after a few seconds and is easy to miss.
      requireInteraction: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/me";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        // Reuse an open classroom tab, moved to the notification's page.
        for (const w of wins) {
          if (w.url.indexOf("/me") !== -1 && "focus" in w) {
            const go = "navigate" in w ? w.navigate(url).catch(() => w) : Promise.resolve(w);
            return go.then((c) => (c || w).focus());
          }
        }
        return self.clients.openWindow(url);
      }),
  );
});
