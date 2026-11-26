export const REVEAL_GAMES = [
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
