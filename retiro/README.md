# Simulador de Retiro FIRE

Simulador de jubilación y libertad financiera para España, en
**[pacolucena.com/retiro](https://pacolucena.com/retiro/)**. Proyecta el patrimonio año a año
hasta los 100 —impuestos, pensión pública, inmuebles, hipotecas y gastos familiares— y busca
la edad más temprana a la que el retiro es seguro: el patrimonio real no se encoge y nunca
falta dinero líquido.

Es gratuito y no tiene servidor: todo se calcula en el navegador y los datos no salen de él.
Comparte el formato del fichero de copia con
[pacolucena.com/balance](https://pacolucena.com/balance/). El tamaño del hogar viaja como
`familyMembers` (1 + pareja + hijos), además de `hasPartner` y `childrenAges`: un fichero que
trae solo el número (el de Balance) ajusta el hogar a él, y si el detalle no cuadra con el número
manda el número.

## Desarrollo

Es un único `index.html` con el CSS y el JavaScript en línea.

```bash
npm install
npm run dev          # desarrollo
npm run css          # recompilar tailwind.css si usas clases nuevas
npm test             # las suites de tests/suites, con Playwright (unos 10 minutos)
npm run test:quick   # sin los dos barridos largos
npm run build        # compilar a dist/, que es lo que publica Cloudflare Pages
```

## El manual

El manual de uso se vende en Amazon:
[Simulador de Retiro FIRE — Manual de uso](https://www.amazon.es/dp/B0HN6R5628). Su texto no
está en este repo.
