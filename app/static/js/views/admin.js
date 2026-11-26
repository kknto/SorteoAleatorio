import { apiFetch, escapeHtml, formatDateTime, showToast } from "../api.js";

let auditVisible = false;
let activeDrawId = null;
let pollTimer = null;

export function stopAdminPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

export async function renderAdmin(appEl) {
  stopAdminPolling();
  appEl.innerHTML = `<div class="loading-state"><div class="spinner"></div><p>Verificando sesión...</p></div>`;

  try {
    const session = await apiFetch("/api/admin/session");
    if (!session.authenticated) {
      renderLogin(appEl, session.using_default_key);
      return;
    }
    await renderDashboard(appEl);
    pollTimer = setInterval(() => {
      if (window.location.pathname === "/admin") {
        renderDashboard(appEl, { silent: true });
      } else {
        stopAdminPolling();
      }
    }, 10000);
  } catch (err) {
    appEl.innerHTML = `<section class="card card-narrow"><p class="badge badge-danger">${escapeHtml(err.message)}</p></section>`;
  }
}

function renderLogin(appEl, usingDefaultKey) {
  appEl.innerHTML = `
    <section class="card card-narrow stack">
      <div>
        <span class="eyebrow">🔐 Acceso Administrador</span>
        <h1 style="margin: 0.55rem 0 0.25rem;">Panel de Control</h1>
        <p class="muted" style="margin: 0;">Ingresa la clave de administrador para gestionar sorteos, participantes y confirmaciones.</p>
      </div>
      ${
        usingDefaultKey
          ? `<div class="badge badge-revealed" style="padding: 0.55rem 0.8rem; border-radius: 10px;">
              💡 Entorno local: clave por defecto <strong>admin123</strong> (configura ADMIN_KEY en Render)
            </div>`
          : ""
      }
      <form id="admin-login-form" class="stack">
        <div>
          <label for="admin-key-input">Clave de Administrador</label>
          <input id="admin-key-input" type="password" placeholder="Ingresa tu clave..." required />
        </div>
        <button type="submit" class="btn btn-primary">Entrar al Panel</button>
      </form>
    </section>
  `;

  document.getElementById("admin-login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const key = document.getElementById("admin-key-input").value;
    try {
      await apiFetch("/api/admin/login", {
        method: "POST",
        body: JSON.stringify({ key }),
      });
      showToast("Sesión iniciada");
      await renderAdmin(appEl);
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

async function renderDashboard(appEl, { silent = false } = {}) {
  try {
    if (silent && document.activeElement && ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement.tagName)) {
      return;
    }

    const drawQuery = activeDrawId ? `?draw_id=${activeDrawId}` : "";
    const [drawsList, draw] = await Promise.all([
      apiFetch("/api/admin/draws"),
      apiFetch(`/api/admin/draw${drawQuery}`),
    ]);
    activeDrawId = draw.id;

    const total = draw.total_participants;
    const confirmed = draw.confirmed_count;
    const pct = total > 0 ? Math.round((confirmed / total) * 100) : 0;
    const isDrawn = draw.status === "drawn";
    const origin = window.location.origin;

    const drawOptionsHtml = drawsList
      .map(
        (d) =>
          `<option value="${d.id}" ${d.id === draw.id ? "selected" : ""}>${escapeHtml(d.title)} (${d.total_participants})</option>`
      )
      .join("");

    const rowsHtml = draw.participants
      .map((p) => {
        const link = `${origin}/p/${p.token}`;
        const waText = encodeURIComponent(
          `¡Hola ${p.name}! Ya puedes descubrir a tu amigo secreto en "${draw.title}". Entra aquí, juega y confirma tu lectura: ${link}`
        );
        const statusBadge = p.confirmed_at
          ? `<span class="badge badge-confirmed">✅ Confirmado (${escapeHtml(formatDateTime(p.confirmed_at))})</span>`
          : p.revealed_at
            ? `<span class="badge badge-revealed">👀 Abierto (sin confirmar)</span>`
            : `<span class="badge badge-pending">⏳ Pendiente</span>`;

        const assignedCell = !isDrawn
          ? `<span class="muted">Sin sortear</span>`
          : auditVisible
            ? `<strong>${escapeHtml(p.assigned_to_name || "—")}</strong>`
            : `<span class="masked-pill">••••••</span>`;

        return `
          <tr>
            <td>
              <strong>${escapeHtml(p.name)}</strong>
              ${p.has_wishlist ? `<div class="muted" style="font-size: 0.78rem;">📝 Lista de deseos lista</div>` : ""}
            </td>
            <td>${assignedCell}</td>
            <td>${statusBadge}</td>
            <td>
              <div class="row-actions">
                <button type="button" class="btn btn-secondary btn-sm copy-link-btn" data-link="${escapeHtml(link)}">📋 Copiar</button>
                <a class="btn btn-secondary btn-sm" href="https://wa.me/?text=${waText}" target="_blank" rel="noopener">💬 WhatsApp</a>
                <button type="button" class="btn btn-secondary btn-sm regen-token-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}" title="Regenerar enlace único">🔄</button>
                ${
                  !isDrawn
                    ? `<button type="button" class="btn btn-danger btn-sm delete-p-btn" data-id="${p.id}" data-name="${escapeHtml(p.name)}" title="Eliminar">✕</button>`
                    : ""
                }
              </div>
            </td>
          </tr>
        `;
      })
      .join("");

    appEl.innerHTML = `
      <div class="stack">
        <section class="card stack">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 1rem;">
            <div class="row-actions" style="flex: 1; min-width: 240px;">
              <select id="draw-selector" style="max-width: 320px;" aria-label="Seleccionar sorteo">
                ${drawOptionsHtml}
              </select>
              <button type="button" class="btn btn-secondary btn-sm" id="new-draw-btn">+ Nuevo sorteo</button>
            </div>
            <div class="row-actions">
              <a class="btn btn-secondary btn-sm" href="/api/admin/draw/export?draw_id=${draw.id}">📥 Exportar CSV</a>
              <button type="button" class="btn btn-secondary btn-sm" id="refresh-admin-btn">🔄 Actualizar</button>
              <button type="button" class="btn btn-secondary btn-sm" id="logout-btn">Cerrar sesión</button>
            </div>
          </div>

          <form id="draw-details-form" class="grid-4" style="align-items: end;">
            <div>
              <label for="draw-title-input">Nombre del evento</label>
              <input id="draw-title-input" type="text" value="${escapeHtml(draw.title)}" required />
            </div>
            <div>
              <label for="draw-budget-input">Presupuesto</label>
              <input id="draw-budget-input" type="text" value="${escapeHtml(draw.budget)}" placeholder="Ej. $300 MXN" />
            </div>
            <div>
              <label for="draw-date-input">Fecha y hora</label>
              <input id="draw-date-input" type="text" value="${escapeHtml(draw.event_date)}" placeholder="Ej. 24 Dic, 8:00 PM" />
            </div>
            <div>
              <label for="draw-location-input">Lugar</label>
              <div style="display: flex; gap: 0.45rem;">
                <input id="draw-location-input" type="text" value="${escapeHtml(draw.event_location)}" placeholder="Ej. Casa de Sofía" />
                <button type="submit" class="btn btn-secondary btn-sm">💾</button>
              </div>
            </div>
          </form>

          <div class="grid-4">
            <div class="kpi-card">
              <div class="kpi-label">Participantes</div>
              <div class="kpi-value">${total}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Abiertos</div>
              <div class="kpi-value">${draw.revealed_count} / ${total}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Confirmados</div>
              <div class="kpi-value" style="color: var(--emerald);">${confirmed} / ${total}</div>
            </div>
            <div class="kpi-card">
              <div class="kpi-label">Integridad</div>
              <div class="kpi-value" style="font-size: 1.15rem; margin-top: 0.45rem;">
                ${
                  isDrawn
                    ? draw.integrity_ok
                      ? '<span class="badge badge-confirmed">🛡️ 100% Verificado</span>'
                      : '<span class="badge badge-danger">⚠️ Revisar</span>'
                    : '<span class="badge badge-pending">Pendiente</span>'
                }
              </div>
            </div>
          </div>

          <div>
            <div style="display: flex; justify-content: space-between; font-size: 0.84rem; margin-bottom: 0.35rem;">
              <span class="muted">Progreso de confirmaciones de lectura</span>
              <strong>${pct}%</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill" style="width: ${pct}%;"></div>
            </div>
          </div>
        </section>

        <div class="grid-2">
          <section class="card stack">
            <h2 style="margin: 0;">👥 Participantes</h2>
            <form id="add-participants-form" class="stack" style="gap: 0.75rem;">
              <div>
                <label for="names-input">Agregar uno o varios nombres (uno por línea o separados por coma)</label>
                <textarea id="names-input" rows="3" placeholder="Ej. Ana&#10;Luis&#10;Carlos" ${isDrawn ? "disabled" : ""}></textarea>
              </div>
              <div class="row-actions">
                <button type="submit" class="btn btn-primary" ${isDrawn ? "disabled" : ""}>+ Agregar</button>
                <button type="button" class="btn btn-secondary" id="seed-15-btn" ${isDrawn ? "disabled" : ""}>
                  ⚡ Cargar 15 de ejemplo
                </button>
              </div>
              ${isDrawn ? `<p class="muted" style="font-size: 0.82rem; margin: 0;">Para agregar o quitar participantes, primero reinicia el sorteo a borrador.</p>` : ""}
            </form>
          </section>

          <section class="card stack">
            <h2 style="margin: 0;">🎲 Motor de Sorteo</h2>
            <p class="muted" style="margin: 0; font-size: 0.9rem;">
              Algoritmo de <strong>Sattolo</strong>: garantiza matemáticamente que nadie se saque a sí mismo, nadie se repita y todos den y reciban regalo (funciona para pares e impares, como 15).
            </p>
            <div class="row-actions">
              <button type="button" class="btn btn-emerald" id="execute-draw-btn" ${total < 2 ? "disabled" : ""}>
                ${isDrawn ? "🔁 Re-sortear" : "🚀 Ejecutar Sorteo"}
              </button>
              ${
                isDrawn
                  ? `<button type="button" class="btn btn-danger" id="reset-draw-btn">↩️ Reiniciar a borrador</button>`
                  : ""
              }
            </div>
          </section>
        </div>

        <section class="card stack">
          <div style="display: flex; flex-wrap: wrap; justify-content: space-between; align-items: center; gap: 0.75rem;">
            <div>
              <h2 style="margin: 0;">📋 Relación de Integrantes y Confirmaciones</h2>
              <p class="muted" style="margin: 0.2rem 0 0; font-size: 0.86rem;">
                Comparte el enlace único por WhatsApp. Si alguien lo comparte por error, usa 🔄 para regenerar su enlace.
              </p>
            </div>
            <button type="button" class="btn ${auditVisible ? "btn-primary" : "btn-secondary"} btn-sm" id="toggle-audit-btn">
              ${auditVisible ? "🙈 Ocultar relación (Modo Auditoría)" : "👁️ Ver relación completa (Auditoría)"}
            </button>
          </div>

          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Participante</th>
                  <th>Le regala a</th>
                  <th>Confirmación de lectura</th>
                  <th>Enlace único (WhatsApp)</th>
                </tr>
              </thead>
              <tbody>
                ${
                  rowsHtml ||
                  `<tr><td colspan="4" class="muted" style="text-align: center; padding: 2rem;">No hay participantes todavía. Usa "Cargar 15 de ejemplo" o agrega nombres arriba.</td></tr>`
                }
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;

    document.getElementById("draw-selector").addEventListener("change", (e) => {
      activeDrawId = Number(e.target.value);
      renderDashboard(appEl);
    });

    document.getElementById("new-draw-btn").addEventListener("click", async () => {
      const title = window.prompt("Nombre del nuevo sorteo:", "Intercambio Oficina 2026");
      if (!title || !title.trim()) return;
      try {
        const created = await apiFetch("/api/admin/draws", {
          method: "POST",
          body: JSON.stringify({ title: title.trim() }),
        });
        activeDrawId = created.id;
        showToast("Nuevo sorteo creado");
        await renderDashboard(appEl);
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("draw-details-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        await apiFetch(`/api/admin/draw?draw_id=${draw.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            title: document.getElementById("draw-title-input").value,
            budget: document.getElementById("draw-budget-input").value,
            event_date: document.getElementById("draw-date-input").value,
            event_location: document.getElementById("draw-location-input").value,
          }),
        });
        showToast("Detalles del evento guardados");
        await renderDashboard(appEl);
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("refresh-admin-btn").addEventListener("click", () => renderDashboard(appEl));
    document.getElementById("logout-btn").addEventListener("click", async () => {
      await apiFetch("/api/admin/logout", { method: "POST" });
      stopAdminPolling();
      await renderAdmin(appEl);
    });

    document.getElementById("toggle-audit-btn").addEventListener("click", () => {
      auditVisible = !auditVisible;
      renderDashboard(appEl);
    });

    document.getElementById("add-participants-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const raw = document.getElementById("names-input").value;
      const names = raw
        .split(/[\n,]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length === 0) return;

      try {
        const res = await apiFetch(`/api/admin/participants?draw_id=${draw.id}`, {
          method: "POST",
          body: JSON.stringify({ names }),
        });
        showToast(`Agregados: ${res.added.length}${res.skipped.length ? ` (omitidos duplicados: ${res.skipped.length})` : ""}`);
        await renderDashboard(appEl);
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("seed-15-btn").addEventListener("click", async () => {
      try {
        const res = await apiFetch(`/api/admin/participants/seed-example?draw_id=${draw.id}`, { method: "POST" });
        showToast(`Se cargaron ${res.added_count} participantes de ejemplo`);
        await renderDashboard(appEl);
      } catch (err) {
        showToast(err.message, "error");
      }
    });

    document.getElementById("execute-draw-btn").addEventListener("click", async () => {
      try {
        await apiFetch(`/api/admin/draw/execute?draw_id=${draw.id}`, {
          method: "POST",
          body: JSON.stringify({ force: false }),
        });
        showToast("¡Sorteo ejecutado correctamente!");
        await renderDashboard(appEl);
      } catch (err) {
        if (err.message.includes("confirmaciones")) {
          if (window.confirm("Ya hay participantes que confirmaron lectura. ¿Seguro que deseas re-sortear y reiniciar sus confirmaciones?")) {
            await apiFetch(`/api/admin/draw/execute?draw_id=${draw.id}`, {
              method: "POST",
              body: JSON.stringify({ force: true }),
            });
            showToast("Sorteo re-ejecutado");
            await renderDashboard(appEl);
          }
        } else {
          showToast(err.message, "error");
        }
      }
    });

    const resetBtn = document.getElementById("reset-draw-btn");
    if (resetBtn) {
      resetBtn.addEventListener("click", async () => {
        if (!window.confirm("¿Reiniciar el sorteo a borrador? Se borrarán las asignaciones actuales.")) return;
        try {
          await apiFetch(`/api/admin/draw/reset?draw_id=${draw.id}`, { method: "POST" });
          showToast("Sorteo reiniciado a borrador");
          await renderDashboard(appEl);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    }

    appEl.querySelectorAll(".copy-link-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(btn.dataset.link);
          showToast("Enlace copiado al portapapeles");
        } catch {
          showToast("No se pudo copiar automáticamente", "error");
        }
      });
    });

    appEl.querySelectorAll(".regen-token-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!window.confirm(`¿Regenerar el enlace único de ${btn.dataset.name}? El enlace anterior dejará de funcionar.`)) return;
        try {
          await apiFetch(`/api/admin/participants/${btn.dataset.id}/regenerate-token`, { method: "POST" });
          showToast(`Enlace regenerado para ${btn.dataset.name}`);
          await renderDashboard(appEl);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });

    appEl.querySelectorAll(".delete-p-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        try {
          await apiFetch(`/api/admin/participants/${btn.dataset.id}`, { method: "DELETE" });
          showToast(`Eliminado: ${btn.dataset.name}`);
          await renderDashboard(appEl);
        } catch (err) {
          showToast(err.message, "error");
        }
      });
    });
  } catch (err) {
    showToast(err.message, "error");
  }
}
