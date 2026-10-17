# finanzas

Tres herramientas gratuitas de finanzas personales, de [pacolucena.com](https://pacolucena.com/).
No tienen servidor: todo se calcula en el navegador y los datos no salen de él.

| Carpeta | Herramienta | En marcha |
| --- | --- | --- |
| [`balance/`](balance/) | **Balance Personal**: patrimonio neto, impuesto sobre el patrimonio, auditoría y niveles FIRE | [pacolucena.com/balance](https://pacolucena.com/balance/) |
| [`retiro/`](retiro/) | **Simulador de Retiro FIRE**: a qué edad puedes jubilarte, año a año hasta los 100 | [pacolucena.com/retiro](https://pacolucena.com/retiro/) |
| [`calculadora/`](calculadora/) | **Calculadora de alquiler**: rentabilidad de comprar un piso para alquilarlo | [pacolucena.com/calculadora](https://pacolucena.com/calculadora/) |

Balance y Retiro comparten el formato del fichero de copia: lo que se guarda en una se abre
en la otra.

Cada carpeta es un proyecto aparte, con su `package.json`, sus pruebas y su forma de compilar.
Se trabaja dentro de ella:

```bash
cd balance && npm install && npm run dev
```

Los manuales de uso de Balance y Retiro se venden en Amazon:
[Balance Personal](https://www.amazon.es/dp/B0HMZTMCJF) y
[Simulador de Retiro FIRE](https://www.amazon.es/dp/B0HN6R5628).
