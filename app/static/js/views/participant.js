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
          <li>Gira la <strong>Ruleta Secreta</strong> para descubrir a quién le regalas.</li>
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

function compressImageFile(file, maxDim = 640, quality = 0.75) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("No se pudo leer la imagen."));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error("Archivo de imagen inválido."));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const ratio = Math.min(maxDim / width, maxDim / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function renderGifteeWishlistContent(state) {
  const hasText = Boolean(state.assigned_to_wishlist);
  const links = state.assigned_to_links || [];
  const images = state.assigned_to_images || [];

  if (!hasText && links.length === 0 && images.length === 0) {
    return '<span class="muted">Todavía no ha escrito sus preferencias. ¡Puedes enviarle una pregunta anónima abajo!</span>';
  }

  return `
    <div class="stack" style="gap: 0.65rem;">
      ${hasText ? `<div style="white-space: pre-wrap;">${escapeHtml(state.assigned_to_wishlist)}</div>` : ""}
      ${
        links.length > 0
          ? `<div class="wishlist-links-list">
              ${links
                .map(
                  (l) =>
                    `<span class="wishlist-link-chip">🔗 <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.title || l.url)}</a></span>`
                )
                .join("")}
            </div>`
          : ""
      }
      ${
        images.length > 0
          ? `<div class="wishlist-images-grid">
              ${images
                .map(
                  (src) =>
                    `<a class="wishlist-thumb" href="${escapeHtml(src)}" target="_blank" rel="noopener noreferrer" title="Ver imagen completa">
                      <img src="${escapeHtml(src)}" alt="Referencia de regalo" loading="lazy" />
                    </a>`
                )
                .join("")}
            </div>`
          : ""
      }
    </div>
  `;
}

export async function renderParticipantToken(appEl, token) {
  appEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Abriendo tu invitación secreta...</p></div>`;

  let selectedMode = REVEAL_GAMES[0].id;
  let hideName = false;
  let draftLinks = [];
  let draftImages = [];

  async function loadAndRender() {
    try {
      const state = await apiFetch(`/api/p/${encodeURIComponent(token)}`);
      draftLinks = [...(state.wishlist_links || [])];
      draftImages = [...(state.wishlist_images || [])];
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
        const modeSwitcherHtml =
          REVEAL_GAMES.length > 1
            ? `<div class="mode-switcher" role="group" aria-label="Modo de juego">
                ${REVEAL_GAMES.map(
                  (g) => `<button type="button" class="mode-btn ${g.id === selectedMode ? "active" : ""}" data-mode="${g.id}">${g.label}</button>`
                ).join("")}
              </div>`
            : "";

        appEl.innerHTML = `
          <div class="stack" style="max-width: 620px; margin: 0 auto;">
            <section class="card game-stage">
              <span class="eyebrow">✨ ${escapeHtml(state.draw_title)}</span>
              <h1 style="margin: 0;">¡Hola, ${escapeHtml(state.name)}!</h1>
              ${chipsHtml}
              ${modeSwitcherHtml}
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
                <div style="margin-top: 0.45rem; font-size: 0.92rem;">
                  ${renderGifteeWishlistContent(state)}
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
          <p class="muted" style="margin: 0.25rem 0 0; font-size: 0.84rem;">Agrega ideas, enlaces de tiendas (Amazon, MercadoLibre, etc.) o hasta 3 imágenes de referencia.</p>
        </div>
        <form id="wishlist-form" class="stack" style="gap: 0.85rem;">
          <div>
            <label for="wishlist-input">Notas, tallas o ideas</label>
            <textarea id="wishlist-input" rows="2" maxlength="600" placeholder="Ej. Me gustan los chocolates amargos, calcetines divertidos o libros. Talla M.">${escapeHtml(currentWishlist || "")}</textarea>
          </div>

          <div class="stack" style="gap: 0.45rem;">
            <label>Enlaces de referencia (máx. 5)</label>
            <div class="wishlist-links-list" id="draft-links-list"></div>
            <div class="grid-2" style="gap: 0.5rem;">
              <input id="new-link-title" type="text" maxlength="80" placeholder="Nombre (ej. Audífonos)" />
              <div style="display: flex; gap: 0.45rem;">
                <input id="new-link-url" type="text" maxlength="500" placeholder="https://..." />
                <button type="button" class="btn btn-secondary btn-sm" id="add-link-btn">+ Enlace</button>
              </div>
            </div>
          </div>

          <div class="stack" style="gap: 0.45rem;">
            <label>Imágenes de referencia (máx. 3)</label>
            <div class="wishlist-images-grid" id="draft-images-grid"></div>
            <div style="display: flex; flex-wrap: wrap; gap: 0.5rem; align-items: center;">
              <input id="new-image-file" type="file" accept="image/*" style="max-width: 240px;" />
              <input id="new-image-url" type="text" maxlength="500" placeholder="O pega URL de imagen (https://...)" style="flex: 1; min-width: 180px;" />
              <button type="button" class="btn btn-secondary btn-sm" id="add-image-url-btn">+ URL</button>
            </div>
          </div>

          <div>
            <button type="submit" class="btn btn-primary btn-sm">💾 Guardar mi lista</button>
          </div>
        </form>
      </section>
    `;
  }

  function renderDraftLinksAndImages() {
    const linksEl = document.getElementById("draft-links-list");
    const imgsEl = document.getElementById("draft-images-grid");
    if (linksEl) {
      linksEl.innerHTML = draftLinks
        .map(
          (l, idx) => `
          <span class="wishlist-link-chip">
            🔗 <a href="${escapeHtml(l.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(l.title || l.url)}</a>
            <button type="button" class="chip-remove remove-link-btn" data-idx="${idx}" title="Quitar">✕</button>
          </span>
        `
        )
        .join("");
      linksEl.querySelectorAll(".remove-link-btn").forEach((b) => {
        b.addEventListener("click", () => {
          draftLinks.splice(Number(b.dataset.idx), 1);
          renderDraftLinksAndImages();
        });
      });
    }

    if (imgsEl) {
      imgsEl.innerHTML = draftImages
        .map(
          (src, idx) => `
          <div class="wishlist-thumb">
            <img src="${escapeHtml(src)}" alt="Imagen ${idx + 1}" />
            <button type="button" class="thumb-remove remove-img-btn" data-idx="${idx}" title="Quitar">✕</button>
          </div>
        `
        )
        .join("");
      imgsEl.querySelectorAll(".remove-img-btn").forEach((b) => {
        b.addEventListener("click", () => {
          draftImages.splice(Number(b.dataset.idx), 1);
          renderDraftLinksAndImages();
        });
      });
    }
  }

  function bindWishlistForm(tok) {
    const form = document.getElementById("wishlist-form");
    if (!form) return;

    renderDraftLinksAndImages();

    document.getElementById("add-link-btn").addEventListener("click", () => {
      if (draftLinks.length >= 5) {
        showToast("Máximo 5 enlaces por participante", "error");
        return;
      }
      const title = document.getElementById("new-link-title").value.trim();
      const url = document.getElementById("new-link-url").value.trim();
      if (!/^https?:\/\//i.test(url)) {
        showToast("El enlace debe iniciar con https:// o http://", "error");
        return;
      }
      draftLinks.push({ title: title || url, url });
      document.getElementById("new-link-title").value = "";
      document.getElementById("new-link-url").value = "";
      renderDraftLinksAndImages();
    });

    document.getElementById("new-image-file").addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (draftImages.length >= 3) {
        showToast("Máximo 3 imágenes por participante", "error");
        return;
      }
      try {
        const compressed = await compressImageFile(file);
        draftImages.push(compressed);
        renderDraftLinksAndImages();
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("add-image-url-btn").addEventListener("click", () => {
      if (draftImages.length >= 3) {
        showToast("Máximo 3 imágenes por participante", "error");
        return;
      }
      const url = document.getElementById("new-image-url").value.trim();
      if (!/^https?:\/\//i.test(url)) {
        showToast("La URL de imagen debe iniciar con https:// o http://", "error");
        return;
      }
      draftImages.push(url);
      document.getElementById("new-image-url").value = "";
      renderDraftLinksAndImages();
    });

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const wishlist = document.getElementById("wishlist-input").value;
      try {
        await apiFetch(`/api/p/${encodeURIComponent(tok)}/wishlist`, {
          method: "PUT",
          body: JSON.stringify({
            wishlist,
            links: draftLinks,
            images: draftImages,
          }),
        });
        showToast("Lista de deseos guardada");
      } catch (err) {
        showToast(err.message, "error");
      }
    });
  }

  await loadAndRender();
}
