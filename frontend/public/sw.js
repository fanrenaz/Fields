self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("push", (event) => {
  const payload = event.data?.json() ?? {};
  const target = payload.target ?? {};
  const url = target.kind === "home" && target.thread_id
    ? `/app/home/${encodeURIComponent(target.thread_id)}`
    : target.kind === "room" && target.room_id && target.message_id
      ? `/app/rooms/${encodeURIComponent(target.room_id)}/messages/${encodeURIComponent(target.message_id)}`
      : target.kind === "room" && target.room_id
        ? `/app/rooms/${encodeURIComponent(target.room_id)}`
        : "/app/home";
  event.waitUntil(self.registration.showNotification(payload.title ?? "Fields", {
    data: { url },
    icon: "/app/icon-192.png",
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/app/home", self.location.origin);
  const url = target.origin === self.location.origin && target.pathname.startsWith("/app/")
    ? target.href
    : new URL("/app/home", self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
    const existing = clients.find((client) => new URL(client.url).pathname.startsWith("/app/"));
    return existing ? existing.focus().then(() => existing.navigate(url)) : self.clients.openWindow(url);
  }));
});
