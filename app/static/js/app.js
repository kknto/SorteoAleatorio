import { renderAdmin, stopAdminPolling } from "./views/admin.js";
import { renderParticipantPortal, renderParticipantToken } from "./views/participant.js";

const appEl = document.getElementById("app");

export function navigate(path) {
  if (window.location.pathname !== path) {
    window.history.pushState({}, "", path);
  }
  route();
}

function route() {
  const path = window.location.pathname;

  if (path === "/admin") {
    renderAdmin(appEl);
    return;
  }

  stopAdminPolling();

  if (path.startsWith("/p/")) {
    const token = decodeURIComponent(path.slice(3));
    if (token) {
      renderParticipantToken(appEl, token);
      return;
    }
  }

  renderParticipantPortal(appEl, navigate);
}

document.addEventListener("click", (e) => {
  const link = e.target.closest("a[data-link]");
  if (!link) return;
  e.preventDefault();
  navigate(link.getAttribute("href"));
});

window.addEventListener("popstate", route);
route();
