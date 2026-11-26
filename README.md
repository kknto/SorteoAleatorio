# 🎁 SorteoAleatorio

Plataforma web interactiva tipo juego para organizar sorteos de intercambio de regalos (Amigo Secreto), diseñada para funcionar con cualquier cantidad de participantes ($N \ge 2$, par o impar), garantizar asignaciones sin repeticiones ni auto-asignaciones, registrar confirmaciones de lectura y desplegarse fácilmente en **Render**.

## ✨ Características principales

- **Cualquier cantidad de participantes ($N \ge 2$, par o impar):** Incluye botón rápido para cargar **15 participantes de ejemplo** y alta individual o en lote.
- **Algoritmo de Sattolo ($O(N)$):** Garantiza matemáticamente que cada integrante tenga a alguien a quien regalar, que nadie se saque a sí mismo y que nadie se repita.
- **Experiencia interactiva tipo juego:** Cada participante recibe un enlace único (`/p/<token>`) o puede entrar con su nombre y PIN de 4 dígitos, eligiendo entre **🎁 Caja Misteriosa** o **🎡 Ruleta Secreta** con confeti al revelar.
- **Confirmación de lectura real (anti-prefetch):** Abrir el enlace no confirma automáticamente (evita falsos positivos por vistas previas de WhatsApp/Telegram); el participante debe pulsar **Confirmar lectura** para registrar fecha y hora.
- **Panel de Administrador con Modo Auditoría:** Permite ver el progreso de confirmaciones en tiempo real, copiar enlaces, compartir por WhatsApp y activar/desactivar el **Modo Auditoría** para verificar la relación completa (`Quién regala → A quién`).
- **Persistencia híbrida:** Usa `SQLite` en desarrollo local y `PostgreSQL` automáticamente en Render mediante `DATABASE_URL`.

## 🚀 Ejecución local

```bash
python -m venv .venv
# En Windows PowerShell:
.\.venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload
```

Abre en tu navegador:
- Participante: `http://127.0.0.1:8000/`
- Administrador: `http://127.0.0.1:8000/admin` (clave local por defecto: `admin123`)

## 🧪 Pruebas automatizadas

```bash
pytest -v
```

## ☁️ Despliegue en Render

1. Sube este repositorio a GitHub:
   ```bash
   git add .
   git commit -m "Base de plataforma SorteoAleatorio"
   git push -u origin main
   ```
2. En [Render](https://render.com), selecciona **New + → Blueprint** y conecta `https://github.com/kknto/SorteoAleatorio.git`.
3. Render leerá [`render.yaml`](render.yaml), creará la base de datos PostgreSQL (`sorteo-db`) y el servicio web (`sorteo-aleatorio`), generando automáticamente `ADMIN_KEY` y `SESSION_SECRET`.
4. Consulta tu `ADMIN_KEY` en **Environment** dentro del dashboard de Render para ingresar a `/admin`.
