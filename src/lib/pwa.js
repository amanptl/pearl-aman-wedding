// Service worker registration + "updated" toast. Owner: utilities agent.
import { toast } from "./ui.js";

/**
 * Register sw.js (offline itinerary). Only on https or localhost, never in edit mode, and skipped under
 * automation (navigator.webdriver) unless the URL has ?sw=1.
 * @returns {Promise<ServiceWorkerRegistration|null>}
 */
export async function registerSW() {
  try {
    if (!("serviceWorker" in navigator)) return null;
    const params = new URLSearchParams(location.search);
    const secure = location.protocol === "https:" || ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    if (!secure) return null;
    if (params.get("edit") === "1" || document.documentElement.dataset.mode === "edit" || location.pathname.includes("/edit/")) return null;
    if (navigator.webdriver && params.get("sw") !== "1") return null;

    const hadController = !!navigator.serviceWorker.controller;
    let notified = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (!hadController || notified) return; // first install is not an update
      notified = true;
      toast("Updated — refresh for the latest details", { action: { label: "Refresh", onClick: () => location.reload() } });
    });
    const reg = await navigator.serviceWorker.register(new URL("sw.js", document.baseURI).href, { scope: new URL("./", document.baseURI).pathname });
    document.documentElement.dataset.sw = "registered";
    reg.update?.().catch(() => {});
    return reg;
  } catch (err) {
    console.warn("Service worker not registered", err);
    return null;
  }
}
