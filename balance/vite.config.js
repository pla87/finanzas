import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: './',
  build: {
    rollupOptions: {
      output: {
        // React aparte de la aplicación. No baja lo que se descarga la primera
        // vez, pero sí lo que se vuelve a descargar: React no cambia entre
        // despliegues, así que cada actualización del balance deja de invalidar
        // en la caché del navegador los 140 kB de la librería. Con los datos de
        // mercado subiendo a main de lunes a viernes, eso son cuatro o cinco
        // despliegues por semana.
        manualChunks(id) {
          if (id.includes('node_modules/react-dom') || id.includes('node_modules/react/') ||
              id.includes('node_modules/scheduler')) {
            return 'react';
          }
        }
      }
    }
  }
});