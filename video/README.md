# Vídeo promocional de TuProfeMaria

Anuncio de ~20 s dirigido a alumnos, en dos formatos y dos variantes, hecho con [Remotion](https://www.remotion.dev/) (React → MP4).

| Composición | Variante | Formato | Salida |
|---|---|---|---|
| `PromoVertical` | marketplace (varios profesores) | 1080×1920 (9:16, TikTok / Reels / Shorts) | `out/tuprofemaria-tiktok.mp4` |
| `PromoWide` | marketplace | 1920×1080 (16:9, YouTube / web) | `out/tuprofemaria-16x9.mp4` |
| `MariaVertical` | single-tenant, María como profesora destacada | 1080×1920 | `out/maria-tiktok.mp4` |
| `MariaWide` | single-tenant | 1920×1080 | `out/maria-16x9.mp4` |

Todas usan el mismo componente (`src/Promo.tsx`) con las props `mode` (`multi` / `single`) y `photo`. Cada escena reordena su contenido según la orientación (`useIsVertical`) y lee la variante con `usePromo()` (`src/mode.tsx`).

## Uso

```bash
cd video
npm install
npm run studio        # editor con vista previa en el navegador
npm run render        # genera los dos MP4 en out/
npm run render:tiktok # solo el vertical
npm run render:maria  # las dos versiones de María
npm run render:all    # los cuatro vídeos
npm run typecheck
```

La primera ejecución descarga Chrome Headless Shell (Remotion trae su propio ffmpeg; no hace falta instalarlo).

## Guion (30 fps, transiciones de 12 frames)

| Escena | Archivo | Duración | Contenido |
|---|---|---|---|
| Gancho | `scenes/Hook.tsx` | 3 s | Logo + «¿Quieres aprender un idioma a tu ritmo?» + Chipi 3D saludando |
| Elegir profe (multi) | `scenes/Teachers.tsx` | 4,5 s | Tarjetas de profesores (idioma, idiomas que habla, prueba gratis) |
| Conoce a María (single) | `scenes/MeetMaria.tsx` | 4,5 s | Foto girada en marco con halo, como el hero single-tenant de la landing, y tarjetas flotantes (inglés, 100% online, prueba gratis) |
| Reservar | `scenes/Booking.tsx` | 5 s | Selector de día y hora, huecos ocupados, botón y aviso «¡Clase reservada!» |
| Chat | `scenes/Chat.tsx` | 4,5 s | Conversación con la profe, material y tarea, burbuja de Chipi |
| Cierre | `scenes/Cta.tsx` | 4,6 s | Logo, eslogan, «Tu primera clase de prueba, gratis», `tuprofemaria.com`, Chipi 3D |

Las duraciones están en `SCENES` (`src/Promo.tsx`); el total se recalcula solo.

## Recursos de marca

- `public/logo.png` y `public/chipi.glb`: copias de `frontend/public/assets/logo.png` y `frontend/public/models/Chipi_Waving.glb`. Si cambian en la web, vuelve a copiarlos.
- Paleta y tipografías (`src/theme.ts`): las de `frontend/tailwind.config.ts` (primary `#E91E8C`, ink `#1a1a2e`…), Poppins para títulos y DM Sans para texto.
- Animaciones inspiradas en las de la landing: manchas que flotan (`blob`), entradas `fade-up` / `pop-in`, flotación de Chipi.

## Versión single-tenant (María)

- Textos: gancho «¿Quieres aprender inglés a tu ritmo?», «Conoce a María, tu profe de inglés», «Habla con María» y cierre «Clases de inglés 1 a 1 con María». Los datos están en `MARIA` (`src/mode.tsx`).
- Foto: copia la foto a `public/` (p. ej. `public/maria.jpg`) y pon su nombre en `MARIA_PHOTO` (`src/Root.tsx`). Sin foto se muestra un avatar con la inicial. También puedes cambiarla en `npm run studio` (panel de props) o con `--props='{"mode":"single","photo":"maria.jpg"}'` al renderizar.
- Recomendado: foto vertical (≈ 4:5) con buena luz y el rostro centrado; se recorta con `object-fit: cover`.

## Notas

- Las pantallas son **mockups** recreados (no capturas): los profesores, mensajes y horarios son de ejemplo. No hay valoraciones ni cifras inventadas.
- El vídeo no lleva audio a propósito: añade una canción con licencia en TikTok/CapCut.
- En vertical, el contenido evita la franja inferior (~200 px) que tapa la interfaz de TikTok.
- `components/Chipi3D.tsx` reproduce el mismo bucle de saludo sin corte que `frontend/components/landing/ChipiMascot3D.tsx`, pero calculado a partir del número de frame (render determinista). El modelo se normaliza a 2 unidades de alto porque la caja rápida de una malla con esqueleto sale ~100 veces más pequeña.
- Render con WebGL por ANGLE (`remotion.config.ts`).
