/* PaperTrail classroom — push service worker.
 * Scope "/" (served from the site root). Its only job is to turn a push
 * message from POST /api/release into a system notification and, on click,
 * open (or focus) the student's /me page. No caching, no offline behaviour. */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = {};
  }
  const title = data.title || "새 피드백";
  const body = data.body || "교수자가 피드백을 보냈습니다.";
  const url = data.url || "/me";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: body,
      data: { url: url },
      tag: "papertrail-feedback",
      renotify: true,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url =
    (event.notification.data && event.notification.data.url) || "/me";
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((wins) => {
        for (const w of wins) {
          if (w.url.indexOf("/me") !== -1 && "focus" in w) return w.focus();
        }
        return self.clients.openWindow(url);
      }),
  );
});
