export const REVEAL_GAMES = [
  {
    id: "mystery-box",
    label: "🎁 Caja Misteriosa",
    mount(container, { onComplete }) {
      let taps = 0;
      const requiredTaps = 3;

      container.innerHTML = `
        <p class="muted">Toca la caja <strong>3 veces</strong> para romper el sello mágico y descubrir a quién le darás regalo.</p>
        <button type="button" class="gift-box-btn" id="gift-box-btn" aria-label="Abrir caja misteriosa">
          <div class="gift-box-lid"></div>
          <div class="gift-box-bow">🎀</div>
          <div class="gift-box-body"></div>
        </button>
        <div class="badge badge-revealed" id="tap-counter">Toques: 0 / ${requiredTaps}</div>
      `;

      const btn = container.querySelector("#gift-box-btn");
      const counter = container.querySelector("#tap-counter");

      btn.addEventListener("click", async () => {
        if (taps >= requiredTaps) return;
        taps += 1;
        btn.classList.remove("shake");
        void btn.offsetWidth;
        btn.classList.add("shake");
        counter.textContent = `Toques: ${taps} / ${requiredTaps}`;

        if (taps >= requiredTaps) {
          btn.classList.add("opened");
          btn.disabled = true;
          counter.textContent = "¡Sello roto! Revelando...";
          setTimeout(() => onComplete(), 450);
        }
      });
    },
  },
  {
    id: "wheel",
    label: "🎡 Ruleta Secreta",
    mount(container, { onComplete }) {
      let spinning = false;
      container.innerHTML = `
        <p class="muted">Gira la ruleta secreta para desbloquear tu misión de regalo.</p>
        <div class="wheel-wrap">
          <div class="wheel-pointer">🔻</div>
          <div class="wheel-disc" id="wheel-disc">
            <div class="wheel-center">✨</div>
          </div>
        </div>
        <button type="button" class="btn btn-primary" id="spin-btn">Girar Ruleta</button>
      `;

      const disc = container.querySelector("#wheel-disc");
      const spinBtn = container.querySelector("#spin-btn");

      spinBtn.addEventListener("click", () => {
        if (spinning) return;
        spinning = true;
        spinBtn.disabled = true;
        spinBtn.textContent = "Girando...";
        const turns = 1440 + Math.floor(Math.random() * 360);
        disc.style.transform = `rotate(${turns}deg)`;
        setTimeout(() => onComplete(), 2250);
      });
    },
  },
];
