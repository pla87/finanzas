import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

// Incrusta la hoja compilada dentro del HTML al construir.
//
// El sitio se sirve bajo una subruta de pacolucena.com. Con la hoja enlazada por ruta relativa,
// una visita sin la barra final -pacolucena.com/calculadora en vez de .../calculadora/- hace que
// el navegador resuelva "assets/..." contra el directorio padre, o sea contra la raíz del
// dominio: la hoja daba 404 y la página salía sin un solo estilo, con el JS funcionando. Ni base
// './' ni una base absoluta arreglan las dos formas de la URL a la vez, y no se puede obligar a
// nadie a escribir la barra. Incrustada no hay ninguna ruta que resolver.
//
// Va en 'pre' para que Vite no llegue a ver el <link> y no emita el .css como recurso aparte.
// Sólo en build: en `vite dev` el enlace se queda, que es lo cómodo para recompilar Tailwind.
function incrustarCss() {
  return {
    name: 'incrustar-css',
    apply: 'build',
    enforce: 'pre',
    // El orden va en el propio gancho: el `enforce` del plugin no ordena transformIndexHtml, y
    // sin esto Vite ya ha reescrito el <link> a ./assets/... cuando nos toca el turno.
    transformIndexHtml: {
      order: 'pre',
      handler(html) {
        const css = readFileSync(new URL('./tailwind.css', import.meta.url), 'utf8');
        return html.replace(
          /<link rel="stylesheet" href="tailwind\.css">/,
          `<style>${css}</style>`
        );
      }
    }
  };
}

export default defineConfig({
  base: './',
  plugins: [incrustarCss()],
  build: {
    outDir: 'dist',
    emptyOutDir: true
  }
});
