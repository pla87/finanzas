// Constantes de la interfaz: símbolos de divisa, divisas admitidas, mercados y
// los valores de reserva que se usan mientras no llega market_data.json.

// --- SÍMBOLOS EXACTOS DE DIVISAS ---
export const CURRENCY_SYMBOLS = {
  EUR: '€', USD: '$', JPY: '¥', GBP: '£',
  CHF: 'Fr', HKD: 'HK$', PHP: '₱'
};

// Divisa base de la herramienta. Es una constante a propósito: ver el
// comentario en el componente.
export const BASE_CURRENCY = 'EUR';

// Diferencial de partida para una hipoteca variable. Un punto sobre el
// euríbor es lo corriente en el mercado español; el usuario pone el suyo.
export const DEFAULT_MORTGAGE_SPREAD_PCT = 1.0;

// Las siete de Retiro, ni una más: un fichero tiene que valer en las dos
// herramientas. Lo que llegue en otra se convierte al importar (ver
// RETIRED_CURRENCY_RATES en finance.js).
export const ALL_SUPPORTED_CURRENCIES = [
  { code: 'EUR', label: 'EUR (€) - Euro' },
  { code: 'USD', label: 'USD ($) - US Dollar' },
  { code: 'JPY', label: 'JPY (¥) - Japanese Yen' },
  { code: 'GBP', label: 'GBP (£) - British Pound' },
  { code: 'CHF', label: 'CHF (Fr) - Swiss Franc' },
  { code: 'HKD', label: 'HKD (HK$) - Hong Kong Dollar' },
  { code: 'PHP', label: 'PHP (₱) - Philippine Peso' }
];

export const DEFAULT_EXCHANGE_RATES = {
  EUR: 1.0, USD: 1.09, JPY: 168.5, GBP: 0.86,
  CHF: 0.96, HKD: 8.52, PHP: 62.4
};

export const STOCK_MARKETS = [
  { id: 'NASDAQ', name: 'NASDAQ (EE.UU.)', currency: 'USD' },
  { id: 'NYSE', name: 'NYSE (Nueva York, EE.UU.)', currency: 'USD' },
  { id: 'IBEX', name: 'IBEX 35 (Bolsa de Madrid, España)', currency: 'EUR' },
  { id: 'LSE', name: 'LSE (Londres, Reino Unido)', currency: 'GBP' },
  { id: 'TSE', name: 'TSE (Tokio, Japón)', currency: 'JPY' },
  { id: 'EURONEXT', name: 'Euronext (Europa)', currency: 'EUR' },
  { id: 'OTRO', name: 'Otro (Mercado personalizado)', currency: 'EUR' }
];

export const DEFAULT_TICKERS_DB = {
  NASDAQ: [
    { ticker: 'MSFT', name: 'Microsoft Corporation', price: 450.00, divYield: 0.70, currency: 'USD' },
    { ticker: 'AAPL', name: 'Apple Inc.', price: 230.00, divYield: 0.50, currency: 'USD' },
    { ticker: 'NVDA', name: 'NVIDIA Corporation', price: 130.00, divYield: 0.05, currency: 'USD' },
    { ticker: 'GOOGL', name: 'Alphabet Inc.', price: 180.00, divYield: 0.25, currency: 'USD' },
    { ticker: 'AMZN', name: 'Amazon.com Inc.', price: 190.00, divYield: 0.00, currency: 'USD' },
    { ticker: 'META', name: 'Meta Platforms Inc.', price: 580.00, divYield: 0.35, currency: 'USD' }
  ],
  NYSE: [
    { ticker: 'BRK.B', name: 'Berkshire Hathaway Inc.', price: 450.00, divYield: 0.00, currency: 'USD' },
    { ticker: 'JPM', name: 'JPMorgan Chase & Co.', price: 220.00, divYield: 2.10, currency: 'USD' },
    { ticker: 'V', name: 'Visa Inc.', price: 280.00, divYield: 0.80, currency: 'USD' }
  ],
  IBEX: [
    { ticker: 'ITX', name: 'Inditex S.A.', price: 50.00, divYield: 3.20, currency: 'EUR' },
    { ticker: 'IBE', name: 'Iberdrola S.A.', price: 12.00, divYield: 4.50, currency: 'EUR' },
    { ticker: 'SAN', name: 'Banco Santander S.A.', price: 4.50, divYield: 4.00, currency: 'EUR' }
  ],
  LSE: [
    { ticker: 'AZN', name: 'AstraZeneca PLC', price: 125.00, divYield: 2.00, currency: 'GBP' },
    { ticker: 'SHEL', name: 'Shell PLC', price: 28.00, divYield: 3.80, currency: 'GBP' }
  ],
  TSE: [
    { ticker: '7203', name: 'Toyota Motor Corp.', price: 2700, divYield: 2.80, currency: 'JPY' }
  ],
  EURONEXT: [
    { ticker: 'MC', name: 'LVMH Moët Hennessy', price: 650.00, divYield: 2.00, currency: 'EUR' }
  ]
};


// El manual de uso, en Amazon con el identificador de afiliado (tag). Se cambia
// solo aquí: la leen la franja de arriba, el aviso de móvil y el botón del final
// de Preguntas Frecuentes, y el pie lleva el aviso de afiliado que pide Amazon.
export const MANUAL_URL = 'https://www.amazon.es/dp/B0HMZTMCJF?tag=pacoluc-21';

// Las dos herramientas del sitio: el aviso de móvil enlaza esta y el pie de los
// hitos FIRE, Retiro. En el aviso, la etiqueta del enlace es la propia dirección
// sin el https:// ni la barra final.
export const TOOL_URLS = {
  balance: 'https://pacolucena.com/balance/',
  retiro: 'https://pacolucena.com/retiro/'
};
