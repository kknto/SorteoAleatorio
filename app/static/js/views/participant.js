import { apiFetch, escapeHtml, formatDateTime, showToast } from "../api.js";
import { launchConfetti } from "../confetti.js";
import { REVEAL_GAMES } from "../games/reveal-registry.js";

export async function renderParticipantPortal(appEl) {
  appEl.innerHTML = `
    <section class="card card-narrow stack" style="text-align: center;">
      <div>
        <span class="eyebrow">🔒 Acceso Privado por WhatsApp</span>
        <h1 style="margin: 0.65rem 0 0.35rem;">¡Bienvenido a SorteoAleatorio!</h1>
        <p class="muted" style="margin: 0;">
          Por seguridad y privacidad, cada participante entra únicamente mediante el <strong>enlace único secreto</strong> que el organizador compartió por WhatsApp.
        </p>
      </div>
      <div class="kpi-card" style="text-align: left;">
        <div style="font-weight: 700; margin-bottom: 0.25rem;">¿Cómo funciona?</div>
        <ol class="muted" style="margin: 0; padding-left: 1.2rem; font-size: 0.9rem;">
          <li>Abre tu enlace privado desde WhatsApp.</li>
          <li>Juega la <strong>Caja Misteriosa</strong> o la <strong>Ruleta Secreta</strong> para descubrir a quién le regalas.</li>
          <li>Pulsa <strong>Confirmar lectura</strong> y llena tu <strong>Lista de Deseos</strong>.</li>
        </ol>
      </div>
    </section>
  `;
}

function renderEventChips(state) {
  const chips = [];
  if (state.budget) chips.push(`💰 Presupuesto: <strong>${escapeHtml(state.budget)}</strong>`);
  if (state.event_date) chips.push(`📅 Fecha: <strong>${escapeHtml(state.event_date)}</strong>`);
  if (state.event_location) chips.push(`📍 Lugar: <strong>${escapeHtml(state.event_location)}</strong>`);
  if (chips.length === 0) return "";
  return `<div class="event-chips">${chips.map((c) => `<span class="event-chip">${c}</span>`).join("")}</div>`;
}

function renderMessagesHtml(messages, otherLabel) {
  if (!messages || messages.length === 0) {
    return `<p class="muted" style="font-size: 0.85rem; margin: 0;">Aún no hay mensajes.</p>`;
  }
  return `
    <div class="chat-list">
      ${messages
        .map(
          (m) => `
        <div class="chat-bubble ${m.from_me ? "me" : "other"}">
          <div class="chat-meta">${m.from_me ? "Tú" : escapeHtml(otherLabel)} · ${escapeHtml(formatDateTime(m.created_at))}</div>
          <div>${escapeHtml(m.content)}</div>
        </div>
      `
        )
        .join("")}
    </div>
  `;
}

export async function renderParticipantToken(appEl, token) {
  appEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Abriendo tu invitación secreta...</p></div>`;

  let selectedMode = REVEAL_GAMES[0].id;
  let hideName = false;

  async function loadAndRender() {
    try {
      const state = await apiFetch(`/api/p/${encodeURIComponent(token)}`);
      const chipsHtml = renderEventChips(state);

      if (state.draw_status !== "drawn") {
        appEl.innerHTML = `
          <div class="stack" style="max-width: 620px; margin: 0 auto;">
            <section class="card game-stage">
              <span class="eyebrow">⏳ En espera</span>
              <h1 style="margin: 0;">¡Hola, ${escapeHtml(state.name)}!</h1>
              ${chipsHtml}
              <p class="muted">El administrador todavía está preparando el sorteo <strong>${escapeHtml(state.draw_title)}</strong>. Mientras tanto, puedes dejar lista tu Lista de Deseos.</p>
              <button type="button" class="btn btn-secondary" id="refresh-wait-btn">Actualizar estado</button>
            </section>
            ${renderWishlistCard(state.wishlist)}
          </div>
        `;
        document.getElementById("refresh-wait-btn").addEventListener("click", loadAndRender);
        bindWishlistForm(token);
        return;
      }

      if (!state.revealed) {
        const modeButtons = REVEAL_GAMES.map(
          (g) => `<button type="button" class="mode-btn ${g.id === selectedMode ? "active" : ""}" data-mode="${g.id}">${g.label}</button>`
        ).join("");

        appEl.innerHTML = `
          <div class="stack" style="max-width: 620px; margin: 0 auto;">
            <section class="card game-stage">
              <span class="eyebrow">✨ ${escapeHtml(state.draw_title)}</span>
              <h1 style="margin: 0;">¡Hola, ${escapeHtml(state.name)}!</h1>
              ${chipsHtml}
              <div class="mode-switcher" role="group" aria-label="Modo de juego">
                ${modeButtons}
              </div>
              <div id="game-mount" class="stack" style="align-items: center; width: 100%;"></div>
            </section>
            ${renderWishlistCard(state.wishlist)}
          </div>
        `;

        appEl.querySelectorAll(".mode-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            selectedMode = btn.dataset.mode;
            loadAndRender();
          });
        });

        const game = REVEAL_GAMES.find((g) => g.id === selectedMode) || REVEAL_GAMES[0];
        const mountEl = document.getElementById("game-mount");
        game.mount(mountEl, {
          onComplete: async () => {
            try {
              await apiFetch(`/api/p/${encodeURIComponent(token)}/reveal`, { method: "POST" });
              launchConfetti();
              await loadAndRender();
            } catch (err) {
              showToast(err.message, "error");
            }
          },
        });
        bindWishlistForm(token);
        return;
      }

      // Revealed state
      appEl.innerHTML = `
        <div class="stack" style="max-width: 780px; margin: 0 auto;">
          <section class="card stack">
            <div style="text-align: center;">
              <span class="eyebrow">🎯 Misión Asignada</span>
              <h1 style="margin: 0.5rem 0 0.25rem;">¡Hola, ${escapeHtml(state.name)}!</h1>
              <p class="muted" style="margin: 0 0 0.65rem;">${escapeHtml(state.draw_title)}</p>
              ${chipsHtml}
            </div>

            <div class="reveal-card">
              <div class="muted" style="font-size: 0.9rem;">Te toca darle un regalo a:</div>
              <div class="reveal-target-name ${hideName ? "blurred" : ""}" id="target-name">
                ${escapeHtml(state.assigned_to_name || "—")}
              </div>
              <div class="row-actions" style="justify-content: center; margin-top: 0.6rem;">
                <button type="button" class="btn btn-secondary btn-sm" id="toggle-privacy-btn">
                  ${hideName ? "👁️ Mostrar nombre" : "🙈 Ocultar nombre"}
                </button>
              </div>
              <div class="kpi-card" style="margin-top: 1rem; text-align: left;">
                <div class="kpi-label">🎁 Lista de deseos de ${escapeHtml(state.assigned_to_name || "tu amigo")}</div>
                <div style="margin-top: 0.35rem; white-space: pre-wrap; font-size: 0.92rem;">
                  ${state.assigned_to_wishlist ? escapeHtml(state.assigned_to_wishlist) : '<span class="muted">Todavía no ha escrito sus preferencias. ¡Puedes enviarle una pregunta anónima abajo!</span>'}
                </div>
              </div>
            </div>

            ${
              state.confirmed
                ? `
              <div class="badge badge-confirmed" style="justify-content: center; padding: 0.75rem 1rem; font-size: 0.92rem;">
                ✅ Lectura confirmada el ${escapeHtml(formatDateTime(state.confirmed_at))}
              </div>
            `
                : `
              <div class="stack" style="gap: 0.65rem;">
                <button type="button" class="btn btn-emerald" id="confirm-read-btn">
                  ✅ Confirmar lectura
                </button>
                <p class="muted" style="text-align: center; font-size: 0.84rem; margin: 0;">
                  Presiona este botón para avisar al administrador que ya conoces a tu amigo secreto.
                </p>
              </div>
            `
            }
          </section>

          ${renderWishlistCard(state.wishlist)}

          <div class="grid-2">
            <section class="card stack">
              <div>
                <h2 style="margin: 0; font-size: 1.15rem;">🕵️ Pistas para ${escapeHtml(state.assigned_to_name || "tu amigo")}</h2>
                <p class="muted" style="margin: 0.25rem 0 0; font-size: 0.84rem;">Envía pistas o preguntas sin revelar tu identidad.</p>
              </div>
              ${renderMessagesHtml(state.to_giftee_messages, state.assigned_to_name || "Destinatario")}
              <form id="msg-giftee-form" class="stack" style="gap: 0.55rem;">
                <input id="msg-giftee-input" type="text" maxlength="400" placeholder="Ej. ¿Qué talla eres o qué color prefieres?" required />
                <button type="submit" class="btn btn-primary btn-sm">Enviar pista anónima</button>
              </form>
            </section>

            <section class="card stack">
              <div>
                <h2 style="margin: 0; font-size: 1.15rem;">💌 Mensajes de tu Amigo Secreto</h2>
                <p class="muted" style="margin: 0.25rem 0 0; font-size: 0.84rem;">Aquí verás las pistas de quien te regala a ti.</p>
              </div>
              ${renderMessagesHtml(state.from_santa_messages, "Tu Amigo Secreto")}
              <form id="msg-santa-form" class="stack" style="gap: 0.55rem;">
                <input id="msg-santa-input" type="text" maxlength="400" placeholder="Responder a tu Amigo Secreto..." required />
                <button type="submit" class="btn btn-secondary btn-sm">Responder</button>
              </form>
            </section>
          </div>
        </div>
      `;

      document.getElementById("toggle-privacy-btn").addEventListener("click", () => {
        hideName = !hideName;
        const nameEl = document.getElementById("target-name");
        const btnEl = document.getElementById("toggle-privacy-btn");
        nameEl.classList.toggle("blurred", hideName);
        btnEl.textContent = hideName ? "👁️ Mostrar nombre" : "🙈 Ocultar nombre";
      });

      const confirmBtn = document.getElementById("confirm-read-btn");
      if (confirmBtn) {
        confirmBtn.addEventListener("click", async () => {
          confirmBtn.disabled = true;
          try {
            await apiFetch(`/api/p/${encodeURIComponent(token)}/confirm`, { method: "POST" });
            showToast("¡Lectura confirmada con éxito!");
            launchConfetti();
            await loadAndRender();
          } catch (err) {
            showToast(err.message, "error");
            confirmBtn.disabled = false;
          }
        });
      }

      bindWishlistForm(token);

      document.getElementById("msg-giftee-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("msg-giftee-input");
        const content = input.value.trim();
        if (!content) return;
        try {
          await apiFetch(`/api/p/${encodeURIComponent(token)}/messages`, {
            method: "POST",
            body: JSON.stringify({ target: "giftee", content }),
          });
          input.value = "";
          showToast("Pista enviada de forma anónima");
          await loadAndRender();
        } catch (err) {
          showToast(err.message, "error");
        }
      });

      document.getElementById("msg-santa-form").addEventListener("submit", async (e) => {
        e.preventDefault();
        const input = document.getElementById("msg-santa-input");
        const content = input.value.trim();
        if (!content) return;
        try {
          await apiFetch(`/api/p/${encodeURIComponent(token)}/messages`, {
            method: "POST",
            body: JSON.stringify({ target: "santa", content }),
          });
          input.value = "";
          showToast("Respuesta enviada a tu Amigo Secreto");
          await loadAndRender();
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    } catch (err) {
      appEl.innerHTML = `
        <section class="card card-narrow stack" style="text-align: center;">
          <h2>Enlace no encontrado</h2>
          <p class="muted">${escapeHtml(err.message)}</p>
          <a href="/" class="btn btn-secondary" data-link>Volver al inicio</a>
        </section>
      `;
    }
  }

  function renderWishlistCard(currentWishlist) {
    return `
      <section class="card stack">
        <div>
          <h2 style="margin: 0; font-size: 1.15rem;">📝 Mi Lista de Deseos</h2>
          <p class="muted" style="margin: 0.25rem 0 0; font-size: 0.84rem;">Ayuda a quien te va a regalar anotando ideas, talla, colores o gustos.</p>
        </div>
        <form id="wishlist-form" class="stack" style="gap: 0.65rem;">
          <textarea id="wishlist-input" rows="2" maxlength="600" placeholder="Ej. Me gustan los chocolates amargos, calcetines divertidos o libros de ciencia ficción. Talla M.">${escapeHtml(currentWishlist || "")}</textarea>
          <div>
            <button type="submit" class="btn btn-secondary btn-sm">💾 Guardar mi lista</button>
          </div>
        </form>
      </section>
    `;
  }

  function bindWishlistForm(tok) {
    const form = document.getElementById("wishlist-form");
    if (!form) return;
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const wishlist = document.getElementById("wishlist-input").value;
      try {
        await apiFetch(`/api/p/${encodeURIComponent(tok)}/wishlist`, {
          method: "PUT",
          body: JSON.stringify({ wishlist }),
        });
        showToast("Lista de deseos guardada");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  await loadAndRender();
}
