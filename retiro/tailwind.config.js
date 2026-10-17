// Misma configuración que llevaba el bloque tailwind.config en línea cuando la hoja de estilos
// se generaba en el navegador con el Play CDN. Ahora se compila con `npm run css` y el
// resultado, tailwind.css, se sirve como un fichero estático.
//
// rgb(var(...) / <alpha-value>) -y no un var() a secas- es lo que permite que Tailwind siga
// generando las utilidades con opacidad (bg-brand-bg/60, border-brand-border/40): con una
// variable opaca no puede inyectar el canal alfa, descarta la utilidad en silencio y el borde
// cae al color por defecto del navegador, que es como los separadores salían blancos.
export default {
  content: ['./index.html'],
  theme: {
    extend: {
      colors: {
        brand: {
          bg: 'rgb(var(--brand-bg) / <alpha-value>)',
          card: 'rgb(var(--brand-card) / <alpha-value>)',
          cardInner: 'rgb(var(--brand-cardInner) / <alpha-value>)',
          border: 'rgb(var(--brand-border) / <alpha-value>)',
          accent: 'rgb(var(--brand-accent) / <alpha-value>)',
          emerald: 'rgb(var(--brand-emerald) / <alpha-value>)',
          rose: 'rgb(var(--brand-rose) / <alpha-value>)',
          amber: 'rgb(var(--brand-amber) / <alpha-value>)',
          purple: 'rgb(var(--brand-purple) / <alpha-value>)',
          sky: 'rgb(var(--brand-sky) / <alpha-value>)',
          textMuted: 'rgb(var(--brand-textMuted) / <alpha-value>)'
        }
      }
    }
  }
};
