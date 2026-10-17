import { defineConfig } from 'vite';

// El simulador es un único index.html con todo el CSS y el JS en línea (Tailwind y Chart.js
// llegan por CDN), así que aquí no hay nada que empaquetar: vite build solo copia la entrada
// a dist/, que es lo que publica Cloudflare Pages. Tener el build montado deja además el
// camino abierto para dejar de depender del CDN de Tailwind más adelante.
export default defineConfig({
  // Rutas relativas: el sitio se sirve bajo /retiro/, no en la raíz del dominio.
  base: './',
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
