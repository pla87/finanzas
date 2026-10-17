import { Fragment, useState, useMemo, useEffect, useRef } from 'react';
import {
  DEFAULT_MACRO_PARAMS,
  calculateLoanAmortization,
  paymentForBalance,
  calculateFamilyLoanPayment,
  calculateFamilyLoanMonths,
  calculateRealEstateReturns,
  assetAnnualCashflow,
  resolveLiability,
  effectiveInterestRatePct,
  refreshHoldingsFromMarket,
  summarizeImport,
  syncLiabilitiesAmortization,
  convertToBase,
  convertExpensesToBase,
  SAVINGS_TAX_BRACKETS,
  buildExportPayload,
  parseImportPayload,
  STOCK_CLASSES,
  PENSION_TYPES,
  ASSET_CLASSES,
  stockClassOf,
  pensionTypeOf,
  syncAssetRatesToMacro,
  retireUnsupportedCurrencies
} from './lib/finance.js';
import { buildAudit } from './lib/audit.js';
import { computeBalance } from './lib/engine.js';
import { buildAssumptions } from './lib/assumptions.js';
import { WEALTH_TAX_REGIONS, WEALTH_TAX_AS_OF } from './lib/wealthTax.js';
import { TRANSLATIONS } from './lib/i18n.js';
import { FAQ_ITEMS, AUDIT_DIMENSION_STYLE } from './lib/faq.js';
import {
  CURRENCY_SYMBOLS, BASE_CURRENCY, DEFAULT_MORTGAGE_SPREAD_PCT,
  ALL_SUPPORTED_CURRENCIES, DEFAULT_EXCHANGE_RATES, STOCK_MARKETS, DEFAULT_TICKERS_DB, MANUAL_URL, TOOL_URLS
} from './lib/constants.js';
import { TooltipProvider, Tooltip } from './components/Tooltip.jsx';
import { TabHeader } from './components/TabHeader.jsx';
import { LocaleContext, FormattedNumberInput } from './components/NumberInput.jsx';
import { ContactEmailButton } from './components/ContactEmail.jsx';
import { COUNTRY_PRESETS, isPresetBasket } from './lib/presets.js';


// --- COMPONENTE TARTA SVG VECTORIAL (Cheese Split) ---
function PieChartSVG({ data, total, formatCurrency, emptyText = 'Sin datos registrados' }) {
if (!total || total <= 0 || !data || data.length === 0) {
return (
  <div className="flex items-center justify-center h-48 text-xs text-slate-500 italic font-sans">
    {emptyText}
  </div>
);
}

let cumulativePct = 0;
const slices = data.filter(d => d.value > 0).map((d) => {
const pct = (d.value / total) * 100;
const startPct = cumulativePct;
cumulativePct += pct;
return { ...d, pct, startPct, endPct: cumulativePct };
});

const getCoordinatesForPercent = (percent) => {
const x = Math.cos(2 * Math.PI * percent);
const y = Math.sin(2 * Math.PI * percent);
return [x, y];
};

return (
<div className="flex flex-col sm:flex-row items-center gap-6">
  <div className="relative w-44 h-44 flex-shrink-0">
    <svg viewBox="-1 -1 2 2" className="w-full h-full -rotate-90" role="img"
         aria-label={slices.map(sl => `${sl.label}: ${sl.pct.toFixed(1)}%`).join('; ')}>
              {slices.length === 1 || slices.some(s => s.pct >= 99.99) ? (
                <circle cx="0" cy="0" r="1" fill={(slices.find(s => s.pct >= 99.99) || slices[0]).color} />
              ) : (
                slices.map((slice, sIdx) => {
          const [startX, startY] = getCoordinatesForPercent(slice.startPct / 100);
          const [endX, endY] = getCoordinatesForPercent(slice.endPct / 100);
          const largeArcFlag = slice.pct > 50 ? 1 : 0;
          const pathData = `M 0 0 L ${startX} ${startY} A 1 1 0 ${largeArcFlag} 1 ${endX} ${endY} Z`;
          return (
            <path
              key={`slice-${sIdx}-${slice.pct.toFixed(2)}-${slice.startPct.toFixed(2)}`}
              d={pathData}
              fill={slice.color}
              className="transition-opacity hover:opacity-80"
            />
          );
        })
      )}
    </svg>
    {total > 0 && (
      <div className="absolute inset-0 m-auto w-20 h-20 rounded-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col items-center justify-center shadow-inner pointer-events-none">
        <span className="text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400">Total</span>
        <span className="text-[11px] font-black font-mono">{formatCurrency(total)}</span>
      </div>
    )}
  </div>

  <div className="flex-1 w-full space-y-2 text-xs">
    {/* Solo las categorías con saldo: las de 0 € solo eran ruido. */}
    {data.filter(item => item.value > 0).map((item, idx) => {
      const pct = total > 0 ? (item.value / total) * 100 : 0;
      return (
        <div key={idx} className="flex justify-between items-center gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-3 h-3 rounded-sm flex-shrink-0" style={{ backgroundColor: item.color }}></span>
            <span className="truncate text-slate-700 dark:text-slate-300 font-medium">{item.label}</span>
          </div>
          <div className="text-right font-mono flex-shrink-0">
            <span className="font-bold">{formatCurrency(item.value)}</span>
            <span className="text-[11px] text-slate-500 dark:text-slate-400 ml-1.5 font-sans">({pct.toFixed(1)}%)</span>
          </div>
        </div>
      );
    })}
  </div>
</div>
);
}

const INITIAL_ASSETS = [
  { id: 'a1', name: '(EJEMPLO) Cuenta Operativa', subcategory: 'cash', currency: 'EUR', value: 6000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 0 },
  { id: 'a2', name: '(EJEMPLO) Fondo de Emergencia', subcategory: 'cash', currency: 'EUR', value: 12000, cashReturnPct: 3.2, useReturnPct: 0, capitalReturnPct: 0 },

  {
    id: 'a3', name: '(EJEMPLO) ETF Vanguard All-World', subcategory: 'stocks', stockType: 'fund', stockClass: 'growth',
    currency: 'EUR', value: 20000, cashReturnPct: 1.8, useReturnPct: 0, capitalReturnPct: 6.5
  },
  {
    id: 'a4', name: '(EJEMPLO) Inditex', subcategory: 'stocks', stockType: 'shares', stockClass: 'dividend',
    market: 'IBEX', ticker: 'ITX', sharesCount: 240, sharePrice: 50.00,
    currency: 'EUR', value: 12000, cashReturnPct: 3.2, useReturnPct: 0, capitalReturnPct: 6.0
  },

  {
    id: 'a5', name: '(EJEMPLO) Vivienda Habitual', subcategory: 'real_estate', currency: 'EUR',
    value: 160000, monthlyRent: 750, useType: 'habitual',
    cashReturnPct: -0.6, useReturnPct: 5.6, capitalReturnPct: 2.0
  },

  { id: 'a6', name: '(EJEMPLO) Plan de Pensiones Indexado', subcategory: 'pensions', pensionType: 'plan', currency: 'EUR', value: 10000, cashReturnPct: 0, useReturnPct: 0, capitalReturnPct: 5.5 },

  { id: 'a7', name: '(EJEMPLO) Vehículo Familiar', subcategory: 'tangibles', currency: 'EUR', value: 10000, cashReturnPct: -2.5, useReturnPct: 4.0, capitalReturnPct: -10.0 }    ];

// Generate dynamic start dates relative to today so sample data is always evergreen
const initDate = new Date();

// Mortgage: arbitrarily set to have started 38 months ago
const mDate = new Date(initDate.getFullYear(), initDate.getMonth() - 38);
const mStart = `${mDate.getFullYear()}-${String(mDate.getMonth() + 1).padStart(2, '0')}`;
const mData = calculateLoanAmortization(130000, 2.4, 300, mStart);

const INITIAL_LIABILITIES = [
  { id: 'l1', name: '(EJEMPLO) Tarjeta de Crédito', subcategory: 'short_term', currency: 'EUR', value: 2500, interestRatePct: 12.0, monthlyPayment: 150 },
  {
    // Un préstamo personal se declara por lo que queda: saldo de hoy y
    // meses que faltan. Son las cifras a las que llegaba el ejemplo
    // anterior a mitad de un préstamo de 10.000 a 48 meses.
    id: 'l2', name: '(EJEMPLO) Préstamo Personal', subcategory: 'personal_loans', currency: 'EUR',
    initialPrincipal: 7283, durationMonths: 34, interestRatePct: 4.9,
    value: 7283, monthlyPayment: paymentForBalance(7283, 4.9, 34)
  },
  {
    id: 'l3', name: '(EJEMPLO) Hipoteca Fija', subcategory: 'mortgages', currency: 'EUR',
    initialPrincipal: 130000, startDate: mStart, durationMonths: 300, interestRatePct: 2.4,
    value: mData.currentBalance, monthlyPayment: mData.monthlyPayment
  }
];


function App() {
  // Solo castellano. El botón de idioma se quitó y con él la forma de volver:
  // quien tuviera 'en' guardado de antes se quedaría en inglés sin poder
  // salir, así que lo guardado ya no se lee. Las traducciones siguen en
  // i18n.js por si el inglés vuelve.
  const lang = 'es';
  const [theme, setTheme] = useState(
    () => localStorage.getItem('fire_v26_theme') || localStorage.getItem('fire_theme_v14') || 'dark'
  );
  // La herramienta es para España: la divisa base es el euro y no se
  // cambia. Poder cambiarla obligaba a convertir los gastos en el sitio
  // —redondeando a dos decimales cada vez— y las cifras se desviaban al
  // ir y volver entre divisas. Los activos siguen teniendo la suya.
  const baseCurrency = BASE_CURRENCY;
  
  // --- LIVE MARKET DATA HOOKS ---
  const [exchangeRates, setExchangeRates] = useState(DEFAULT_EXCHANGE_RATES);
  const [tickersDb, setTickersDb] = useState(DEFAULT_TICKERS_DB);
  const [isOfflineRates, setIsOfflineRates] = useState(false);
  const [marketDataMeta, setMarketDataMeta] = useState(null);
  const [expandedAssumption, setExpandedAssumption] = useState(null);
  // Euríbor a 12 meses: la referencia de las hipotecas variables españolas.
  const [euribor, setEuribor] = useState(null);

  useEffect(() => {
    fetch('./market_data.json')
      .then(res => {
        if (!res.ok) throw new Error('market_data.json not ready');
        return res.json();
      })
      .then(data => {
        // Fusionamos sobre los valores por defecto: si falta un par, antes
        // quedaba indefinido y toBase lo trataba como 1:1 con el euro.
        if (data.rates) setExchangeRates({ ...DEFAULT_EXCHANGE_RATES, ...data.rates });
        if (data.tickers) setTickersDb(data.tickers);
        if (data.euribor && Number.isFinite(Number(data.euribor.ratePct))) setEuribor(data.euribor);
        setMarketDataMeta({ generatedAt: data.generatedAt || null, staleRates: data.staleRates || [] });
        setIsOfflineRates(false);
      })
    .catch((err) => {
      console.warn('Usando datos de mercado offline por defecto:', err);
      setExchangeRates(DEFAULT_EXCHANGE_RATES);
      setTickersDb(DEFAULT_TICKERS_DB);
      setIsOfflineRates(true);
    });
  }, []);

  const t = TRANSLATIONS[lang] || TRANSLATIONS.es;
  const isDark = theme === 'dark';

  // Nombres de los subtipos y de las clases. Van con la clave escrita entera,
  // no por acceso dinámico, para que la prueba de claves muertas las vea.
  const STOCK_CLASS_LABEL = {
    growth: t.stock_class_growth, dividend: t.stock_class_dividend,
    bonds: t.stock_class_bonds, tips: t.stock_class_tips, gold: t.stock_class_gold
  };
  const PENSION_TYPE_LABEL = { plan: t.pension_type_plan, insurance: t.pension_type_insurance };
  const USE_TYPE_LABEL = { habitual: t.use_habitual, rented: t.use_rented, vacant: t.use_vacant, land: t.use_land };
  const ASSET_CLASS_CHART = {
    cash: { label: t.sec_cash.replace(/^\d+\.\s*/, ''), color: '#10b981' },
    equity: { label: t.chart_class_equity, color: '#06b6d4' },
    fixed_income: { label: t.chart_class_fixed_income, color: '#3b82f6' },
    gold: { label: t.chart_class_gold, color: '#eab308' },
    real_estate: { label: t.sec_real_estate.replace(/^\d+\.\s*/, ''), color: '#8b5cf6' },
    pensions: { label: t.sec_pensions.replace(/^\d+\.\s*/, ''), color: '#f59e0b' },
    tangibles: { label: t.sec_tangibles.replace(/^\d+\.\s*/, ''), color: '#ec4899' }
  };

  const fileInputRef = useRef(null);
  const [dataFeedbackMsg, setDataFeedbackMsg] = useState(null);

  // Un solo nivel de deshacer para los borrados. Guarda la lista entera de
  // antes, no el elemento suelto: así vuelve también a su sitio en el
  // orden, que es la mitad de lo que se pierde al borrar por error.
  const [pendingUndo, setPendingUndo] = useState(null);
  const [importPreview, setImportPreview] = useState(null);
  // Qué se convirtió a euros por venir en una divisa que ya no se admite.
  const [currencyNotice, setCurrencyNotice] = useState(null);

  useEffect(() => {
    const metaTheme = document.getElementById('theme-color-meta');
    // Los mismos dos colores que declara la paleta en index.css. El del
    // navegador tiene que ir en literal: la barra del sistema no entiende
    // variables CSS.
    const targetColor = isDark ? '#090d16' : '#f1f5f9';

    // El tema se marca en <html data-theme>, igual que retiro. La variante
    // `dark:` de Tailwind está atada a ese atributo, así que basta con esto
    // para mover a la vez las utilidades y las variables de la paleta.
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');

    if (metaTheme) {
      metaTheme.setAttribute('content', targetColor);
    }
    // El fondo lo pinta ya la paleta; se limpia el que hubiera quedado
    // escrito a mano para que no gane sobre ella.
    document.body.style.backgroundColor = '';
  }, [isDark]);

  const safeParse = (key, fallback) => {
    try {
      const item = localStorage.getItem(key);
      if (!item) return fallback;
      const parsed = JSON.parse(item);
      return (typeof fallback === 'object' && !Array.isArray(fallback) && fallback !== null)
        ? { ...fallback, ...parsed }
        : parsed;
    } catch {
      return fallback;
    }
  };

  const [macroParams, setMacroParams] = useState(() => {
    const parsed = safeParse('v14_macro_params', DEFAULT_MACRO_PARAMS);
    if (parsed.realEstateMaintenancePct !== undefined) {
      parsed.realEstateMaintenancePct = Math.abs(parsed.realEstateMaintenancePct);
    }
    return parsed;
  });

  // Sincroniza automáticamente los porcentajes de activos inmobiliarios y fondos cuando cambian las variables macro
    const isFirstMacroRun = useRef(true);
    useEffect(() => {
      if (isFirstMacroRun.current) {
        isFirstMacroRun.current = false;
        return;
      }
      setAssets(prev => syncAssetRatesToMacro(prev, macroParams));
    }, [macroParams]);

  // Lo guardado en este navegador puede venir de cuando se admitían diez
  // divisas. Se pasa a euros al cargar, igual que un fichero, y se avisa una
  // vez: sin esto, una posición en yuanes se leía a la par con el euro.
  const conversionAlCargar = useRef([]);
  const [assets, setAssets] = useState(() => {
    const r = retireUnsupportedCurrencies(safeParse('v14_assets', INITIAL_ASSETS), null, 'asset');
    conversionAlCargar.current.push(...r.converted);
    return r.items;
  });
  const [liabilities, setLiabilities] = useState(() => {
    const r = retireUnsupportedCurrencies(safeParse('v14_liabilities', INITIAL_LIABILITIES), null, 'liability');
    conversionAlCargar.current.push(...r.converted);
    return syncLiabilitiesAmortization(r.items);
  });
  const [activeTab, setActiveTab] = useState('assets');

  useEffect(() => {
    if (conversionAlCargar.current.length) setCurrencyNotice([...conversionAlCargar.current]);
  }, []);
  
  const [selectedCountry, setSelectedCountry] = useState(() => localStorage.getItem('fire_country_v14') || 'es_urban');
  const [familyMembers, setFamilyMembers] = useState(() => Number(localStorage.getItem('fire_members_v14')) || 2);
  
  useEffect(() => { localStorage.setItem('fire_country_v14', selectedCountry); }, [selectedCountry]);
  useEffect(() => { localStorage.setItem('fire_members_v14', String(familyMembers)); }, [familyMembers]);

  const [expenses, setExpenses] = useState(() => {
    const parsed = safeParse('v14_expenses', {
      person_monthly: COUNTRY_PRESETS.es_urban.person_monthly,
      household_monthly: COUNTRY_PRESETS.es_urban.household_monthly,
      family_annual: COUNTRY_PRESETS.es_urban.family_annual
    });
    if (parsed.family_annual && parsed.family_annual.propertyTax !== undefined) {
      delete parsed.family_annual.propertyTax;
    }
    return parsed;
  });

  // Los gastos arrancan con la cesta media de un país, y casi toda la
  // auditoría depende de ellos: si nadie los cambia, la herramienta juzga un
  // hogar que no es el tuyo. Aquí se apunta de qué país es la media mientras
  // nadie la toque (null cuando ya son gastos propios), para avisar en la
  // pestaña. Quien tenía gastos guardados de antes de que existiera el aviso
  // no trae la marca, y se deduce comparando con la cesta del país elegido.
  const [expensesSample, setExpensesSample] = useState(() => {
    try {
      const guardado = localStorage.getItem('balance_expenses_sample');
      if (guardado !== null) return guardado || null;
    } catch { /* sin almacenamiento, se deduce */ }
    return isPresetBasket(expenses, selectedCountry) ? selectedCountry : null;
  });
  useEffect(() => {
    try { localStorage.setItem('balance_expenses_sample', expensesSample || ''); } catch { /* el aviso no debe romper nada */ }
  }, [expensesSample]);

  // Cualquier cambio a mano en los gastos los convierte en propios.
  const editExpenses = next => {
    setExpenses(next);
    setExpensesSample(null);
  };

  const [editingAsset, setEditingAsset] = useState(null);
  const [editingLiability, setEditingLiability] = useState(null);
  const [isNewAsset, setIsNewAsset] = useState(false);
  const [isNewLiability, setIsNewLiability] = useState(false);

  const [tickerQuery, setTickerQuery] = useState('');
  const [showTickerDropdown, setShowTickerDropdown] = useState(false);

  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [showFaqModal, setShowFaqModal] = useState(false);
  const [showOnboardingModal, setShowOnboardingModal] = useState(() => {
    return !localStorage.getItem('patrimonio_onboarding_shown');
  });

  // --- AVISO DE MÓVIL ---
  // Se abre al primer toque en cualquier parte de la página, una vez por
  // visita: la marca vive en sessionStorage, y si el navegador no deja
  // escribir en él (modo privado estricto, almacenamiento bloqueado) basta con
  // la variable del efecto, que lo limita a una vez por carga. Solo por debajo
  // de 640 px, la misma condición que la cenefa.
  // Escucha en fase de captura y anula ese primer toque: si no, el mismo dedo
  // que abre el aviso pulsaría también el botón o la pestaña de debajo. Se
  // anula el pointerdown y el click que lo sigue, y nada más; el siguiente
  // toque ya es del usuario.
  // Misma lógica que en /retiro (index.html), y la marca es la misma: las dos
  // herramientas son el mismo origen, así que quien ya lo vio en una no lo
  // vuelve a ver en la otra. Va fuera del estado de React salvo el «abierto»,
  // para que tocar la pantalla no provoque ningún repintado.
  const [showMobileModal, setShowMobileModal] = useState(false);
  useEffect(() => {
    const CLAVE = 'pacolucena_aviso_movil';
    let visto = false;
    try { visto = sessionStorage.getItem(CLAVE) === '1'; } catch (err) {}
    if (visto) return undefined;

    const tragarClick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      soltar();
    };
    const soltar = () => {
      window.removeEventListener('click', tragarClick, true);
      window.removeEventListener('pointerdown', soltar, true);
    };
    const alPrimerToque = (e) => {
      if (visto || !window.matchMedia('(max-width: 639px)').matches) return;
      e.preventDefault();
      e.stopPropagation();
      visto = true;
      try { sessionStorage.setItem(CLAVE, '1'); } catch (err) {}
      window.removeEventListener('pointerdown', alPrimerToque, true);
      // El click de este mismo gesto llega después; si el gesto acaba en
      // scroll no llega, y entonces lo suelta el siguiente pointerdown para no
      // tragarse un toque ajeno.
      window.addEventListener('click', tragarClick, true);
      window.addEventListener('pointerdown', soltar, true);
      setShowMobileModal(true);
    };
    window.addEventListener('pointerdown', alPrimerToque, true);
    return () => {
      window.removeEventListener('pointerdown', alPrimerToque, true);
      soltar();
    };
  }, []);

  const handleCloseOnboarding = () => {
    localStorage.setItem('patrimonio_onboarding_shown', 'true');
    setShowOnboardingModal(false);
  };

  // --- COTIZACIONES AL DÍA SIN PEDIRLO ---
  // Las posiciones guardaban el precio del día en que se crearon. En vez de
  // un botón que había que acordarse de pulsar, se revalúan solas una vez
  // por sesión, en cuanto llegan los datos de mercado del día. Lo hace en
  // silencio: el aviso de «se han actualizado N posiciones» salía en cada
  // carga y se leía como un error. La fecha de los datos está en Parámetros.
  const quotesSyncedRef = useRef(false);
  useEffect(() => {
    if (quotesSyncedRef.current) return;
    if (isOfflineRates) return;              // sin datos frescos no hay nada que aplicar
    if (!marketDataMeta) return;             // aún no ha llegado market_data.json

    quotesSyncedRef.current = true;
    setAssets(prev => {
      const { assets: next, changes } = refreshHoldingsFromMarket(prev, tickersDb);
      if (changes.length === 0) return prev;
      return next;
    });
  }, [marketDataMeta, isOfflineRates, tickersDb]);

  // Los datos de ejemplo se reconocen por su prefijo; mientras estén,
  // ofrecemos vaciarlos de una vez en lugar de fila por fila.
  const hasSampleData = [...assets, ...liabilities].some(i => String(i.name || '').includes('(EJEMPLO)'));

  const handleClearSampleData = () => {
    if (!window.confirm(t.confirm_clear_samples)) return;
    setAssets(prev => prev.filter(a => !String(a.name || '').includes('(EJEMPLO)')));
    setLiabilities(prev => prev.filter(l => !String(l.name || '').includes('(EJEMPLO)')));
  };

  // Borra guardando de qué se puede volver. Un borrado nuevo sustituye al
  // aviso anterior: es un nivel, no una pila.
  const deleteWithUndo = (kind, previousItems, message) => {
    setPendingUndo({ kind, items: previousItems, message, at: Date.now() });
  };

  const undoDelete = () => {
    if (!pendingUndo) return;
    if (pendingUndo.kind === 'assets') setAssets(pendingUndo.items);
    else setLiabilities(pendingUndo.items);
    setPendingUndo(null);
  };

  // El aviso se va solo. Si no, se queda ahí ofreciendo deshacer algo que
  // pasó hace media hora y que ya nadie recuerda.
  useEffect(() => {
    if (!pendingUndo) return;
    const id = setTimeout(() => setPendingUndo(null), 12000);
    return () => clearTimeout(id);
  }, [pendingUndo]);

  // Deja la herramienta como recién abierta: el balance de ejemplo y los
  // parámetros por defecto. Es lo contrario de «Borrar todo», que vacía;
  // esto devuelve algo con lo que trastear.
  const handleRestoreSampleData = () => {
    if (!window.confirm(t.confirm_restore_sample)) return;
    setAssets(INITIAL_ASSETS);
    setLiabilities(syncLiabilitiesAmortization(INITIAL_LIABILITIES, { euriborPct }));
    setExpenses({
      person_monthly: COUNTRY_PRESETS.es_urban.person_monthly,
      household_monthly: COUNTRY_PRESETS.es_urban.household_monthly,
      family_annual: COUNTRY_PRESETS.es_urban.family_annual
    });
    setMacroParams(DEFAULT_MACRO_PARAMS);
    setSelectedCountry('es_urban');
    setFamilyMembers(2);
    setExpensesSample('es_urban');
    setPendingUndo(null);
    setDataFeedbackMsg({ type: 'success', text: t.restore_sample_done });
  };

  // --- DELETE ALL HANDLERS ---
  const handleDeleteAllAssets = () => {
    if (window.confirm(t.confirm_delete_all_assets)) {
      deleteWithUndo('assets', assets, t.undo_deleted_assets.replace('{n}', String(assets.length)));
      setAssets([]);
    }
  };

  const handleDeleteAllDebts = () => {
    if (window.confirm(t.confirm_delete_all_debts)) {
      deleteWithUndo('liabilities', liabilities, t.undo_deleted_liabilities.replace('{n}', String(liabilities.length)));
      setLiabilities([]);
    }
  };

  // --- UP / DOWN SORTING HELPERS ---
    const moveAsset = (idx, direction, subcategory) => {
    const subItems = assets.filter(a => a.subcategory === subcategory);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= subItems.length) return;

    const reorderedSub = [...subItems];
    const [movedItem] = reorderedSub.splice(idx, 1);
    reorderedSub.splice(targetIdx, 0, movedItem);

    let subIdx = 0;
    const newAssets = assets.map(a => {
      if (a.subcategory === subcategory) {
        const item = reorderedSub[subIdx];
        subIdx++;
        return item;
      }
      return a;
    });
    setAssets(newAssets);
  };

  const moveLiability = (idx, direction, subcategory) => {
    const subItems = liabilities.filter(l => l.subcategory === subcategory);
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= subItems.length) return;

    const reorderedSub = [...subItems];
    const [movedItem] = reorderedSub.splice(idx, 1);
    reorderedSub.splice(targetIdx, 0, movedItem);

    let subIdx = 0;
    const newLiabs = liabilities.map(l => {
      if (l.subcategory === subcategory) {
        const item = reorderedSub[subIdx];
        subIdx++;
        return item;
      }
      return l;
    });
    setLiabilities(newLiabs);
  };
  
  const [showShareModal, setShowShareModal] = useState(false);
  const [copiedNotification, setCopiedNotification] = useState(false);
  const [expandedFaq, setExpandedFaq] = useState(null);
  const [feedbackData, setFeedbackData] = useState({ name: '', email: '', type: 'idea', message: '', gotcha: '' });
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackError, setFeedbackError] = useState(null);

  // Mientras haya un diálogo abierto el foco entra en él, no se escapa con
  // el tabulador y vuelve al elemento de origen al cerrarse.
  // Qué diálogos están abiertos ahora mismo. La clave cambia al abrirse o
  // cerrarse cualquiera, no solo al pasar de ninguno a alguno: antes era un
  // booleano y abrir un segundo diálogo sobre el primero no reejecutaba
  // nada, así que el foco se quedaba en el de debajo.
  const openModals = [
    editingAsset && 'asset',
    editingLiability && 'liability',
    importPreview && 'import',
    showFaqModal && 'faq',
    showShareModal && 'share',
    showOnboardingModal && 'onboarding',
    showFeedbackModal && 'feedback',
    showMobileModal && 'mobile'
  ].filter(Boolean);
  const openModalsKey = openModals.join(',');

  // Pila por orden de apertura. El último en abrirse es el que está encima,
  // que no tiene por qué ser el primero del DOM: los diálogos se pintan en
  // el orden del JSX, no en el que los abre el usuario. `querySelector`
  // cogía siempre el primero, de modo que en la primera visita —con el
  // modal de bienvenida abierto— abrir una ficha dejaba el foco en el otro.
  const modalStackRef = useRef([]);
  modalStackRef.current = [
    ...modalStackRef.current.filter(m => openModals.includes(m)),
    ...openModals.filter(m => !modalStackRef.current.includes(m))
  ];
  const topModal = modalStackRef.current[modalStackRef.current.length - 1] || null;
  // El manejador de Escape se registra una sola vez, así que lee de aquí
  // cuál está encima en lugar de capturarlo en su cierre.
  const topModalRef = useRef(null);
  topModalRef.current = topModal;

  useEffect(() => {
    if (!topModal) return;
    const previouslyFocused = document.activeElement;
    const dialog = document.querySelector(`[role="dialog"][data-modal="${topModal}"]`)
      || document.querySelector('[role="dialog"]');
    const focusables = () => Array.from(dialog ? dialog.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    // getClientRects, no offsetParent: dentro de un contenedor `fixed`
    // offsetParent es null aunque el elemento se vea perfectamente.
    ) : []).filter(el => el.getClientRects().length > 0);

    const first = focusables()[0];
    if (first) first.focus();

    const trap = (e) => {
      if (e.key !== 'Tab') return;
      const items = focusables();
      if (items.length === 0) return;
      const firstEl = items[0];
      const lastEl = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstEl) {
        e.preventDefault();
        lastEl.focus();
      } else if (!e.shiftKey && document.activeElement === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    };
    document.addEventListener('keydown', trap, true);
    return () => {
      document.removeEventListener('keydown', trap, true);
      if (previouslyFocused && typeof previouslyFocused.focus === 'function') previouslyFocused.focus();
    };
  }, [topModal, openModalsKey]);

  useEffect(() => {
    const handleKeyDown = (e) => {
        if (e.key === 'Escape') {
          setShowTickerDropdown(false);
          // Solo el de encima. Cerrarlos todos hacía que descartar la
          // bienvenida se llevara por delante la ficha que hubiera detrás.
          const cerrar = {
            asset: () => setEditingAsset(null),
            liability: () => setEditingLiability(null),
            import: () => setImportPreview(null),
            faq: () => setShowFaqModal(false),
            share: () => setShowShareModal(false),
            onboarding: () => setShowOnboardingModal(false),
            feedback: () => setShowFeedbackModal(false),
            mobile: () => setShowMobileModal(false)
          }[topModalRef.current];
          if (cerrar) cerrar();
        }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    localStorage.setItem('fire_lang_v14', lang);
    document.documentElement.lang = lang;
  }, [lang]);
  useEffect(() => { localStorage.setItem('fire_v26_theme', theme); }, [theme]);
  useEffect(() => { localStorage.setItem('v14_macro_params', JSON.stringify(macroParams)); }, [macroParams]);
  useEffect(() => { localStorage.setItem('v14_assets', JSON.stringify(assets)); }, [assets]);
  useEffect(() => { localStorage.setItem('v14_liabilities', JSON.stringify(liabilities)); }, [liabilities]);
  useEffect(() => { localStorage.setItem('v14_expenses', JSON.stringify(expenses)); }, [expenses]);

const handleExportPDF = () => {
    window.print();
  };

  const handleExportData = () => {
    const exportObject = buildExportPayload({
      assets, liabilities, expenses, macroParams,
      baseCurrency, selectedCountry, familyMembers, exchangeRates
    });

    const jsonString = JSON.stringify(exportObject, null, 2);
    // Dentro va JSON, pero se descarga como .txt, igual que en Retiro: los botones dicen .txt
    // y un fichero de texto asusta menos a quien no sabe qué es un .json. Cargar acepta los dos.
    const blob = new Blob([jsonString], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const dateStr = new Date().toISOString().slice(0, 10);
    link.download = `balance-${dateStr}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setDataFeedbackMsg({ type: 'success', text: t.backup_downloaded });
    setTimeout(() => setDataFeedbackMsg(null), 4000);
  };

 const handleImportData = (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);

        const next = parseImportPayload(parsed, {
          expenseFallback: {
            person_monthly: COUNTRY_PRESETS.es_urban.person_monthly,
            household_monthly: COUNTRY_PRESETS.es_urban.household_monthly,
            family_annual: COUNTRY_PRESETS.es_urban.family_annual
          }
        });

        // Cargar una copia reemplaza el balance entero. Antes de hacerlo,
        // se enseña qué entra y qué se pierde.
        setImportPreview({
          next,
          summary: summarizeImport(
            next,
            { assets, liabilities, expenses, familyMembers: validFamilyMembers },
            baseCurrency,
            exchangeRates
          )
        });
      } catch (err) {
        console.error('Error importing backup:', err);
        setDataFeedbackMsg({ type: 'error', text: t.import_error_msg });
      } finally {
        e.target.value = '';
        setTimeout(() => setDataFeedbackMsg(null), 5000);
      }
    };

    reader.readAsText(file);
  };

const applyImportPreview = () => {
    if (!importPreview) return;
    const next = importPreview.next;

    if (next.selectedCountry) setSelectedCountry(next.selectedCountry);
    if (next.familyMembers !== undefined) setFamilyMembers(next.familyMembers);
    setMacroParams(next.macroParams);
    setAssets(next.assets || []);
    setLiabilities(next.liabilities || []);
    // Un fichero guardado con otra divisa base trae los gastos en esa
    // divisa. Los activos llevan la suya y se convierten solos, pero los
    // gastos no, así que hay que pasarlos aquí: leerlos como si fueran
    // euros los dejaría desviados por el tipo de cambio.
    if (next.expenses) setExpenses(convertExpensesToBase(next.expenses, next.baseCurrency, baseCurrency, exchangeRates));
    // Lo que viene de un fichero se da por propio, aunque coincida con una media.
    setExpensesSample(null);

    setImportPreview(null);
    if (next.currencyConversions?.length) setCurrencyNotice(next.currencyConversions);
    setDataFeedbackMsg({ type: 'success', text: t.import_success_msg });
    setTimeout(() => setDataFeedbackMsg(null), 5000);
  };

const applyCountryPreset = () => {
    const preset = COUNTRY_PRESETS[selectedCountry];
    if (preset) {
      const benchCurrency = selectedCountry.startsWith('us_') ? 'USD' : selectedCountry.startsWith('uk_') ? 'GBP' : 'EUR';
      
      const convertObj = (obj) => {
        const res = {};
        Object.entries(obj).forEach(([k, v]) => {
          res[k] = Math.round(toBase(v, benchCurrency));
        });
        return res;
      };

      setExpenses({
        person_monthly: convertObj(preset.person_monthly),
        household_monthly: convertObj(preset.household_monthly),
        family_annual: convertObj(preset.family_annual)
      });
      setExpensesSample(selectedCountry);
    }
  };

  
    const toBase = (val, fromCurr) => convertToBase(val, fromCurr, baseCurrency, exchangeRates);
  const euriborPct = euribor ? Number(euribor.ratePct) : null;
  const regimenPatrimonio = WEALTH_TAX_REGIONS[macroParams.wealthTaxRegion] || WEALTH_TAX_REGIONS.estatal;

  // Un único idioma para mostrar y para leer números.
  const numberLocale = lang === 'es' ? 'es-ES' : 'en-US';

  const formatNumber = (val, maxDec = 2) => {
    const num = Number(val || 0);
    return new Intl.NumberFormat(numberLocale, {
      useGrouping: true,
      minimumFractionDigits: 0,
      maximumFractionDigits: maxDec
    }).format(num);
  };

  // «Fondo Shanghái (CNY a 7,5252 por euro), …» para el aviso de divisas.
  const describeConversions = (lista) => lista
    .map(c => t.currency_retired_item.replace('{name}', c.name).replace('{currency}', c.currency).replace('{rate}', formatNumber(c.rate, 4)))
    .join(', ');

    const formatCurrency = (val, curr = baseCurrency) => {
    const num = Math.round(Number(val || 0));
    const absNum = Math.abs(num);
    const formattedNum = new Intl.NumberFormat(numberLocale, {
      useGrouping: true,
      maximumFractionDigits: 0
    }).format(absNum);
  const sym = (curr && CURRENCY_SYMBOLS[curr]) ? CURRENCY_SYMBOLS[curr] : (CURRENCY_SYMBOLS[baseCurrency] || curr || '€');
  const sign = num < 0 ? '-' : '';
    return lang === 'es' ? `${sign}${formattedNum}\u00A0${sym}` : `${sign}${sym}${formattedNum}`;
  };

  const formatCurrencyCompact = (val, curr = baseCurrency) => {
    const num = Number(val) || 0;
    const abs = Math.abs(num);
    const sym = (curr && CURRENCY_SYMBOLS[curr]) ? CURRENCY_SYMBOLS[curr] : (CURRENCY_SYMBOLS[baseCurrency] || curr || '€');
    const sign = num < 0 ? '-' : '';
    const compacta = (valor, decimales, sufijo) => {
      const texto = new Intl.NumberFormat(numberLocale, {
        minimumFractionDigits: decimales, maximumFractionDigits: decimales
      }).format(valor) + sufijo;
      return lang === 'es' ? `${sign}${texto}\u00A0${sym}` : `${sign}${sym}${texto}`;
    };
    if (abs >= 1000000) return compacta(abs / 1000000, 2, 'M');
    if (abs >= 10000) return compacta(abs / 1000, 0, 'K');
    // Por debajo de diez mil la abreviatura no ahorra sitio y sí precisión.
    return formatCurrency(num, curr);
  };

  // El cálculo vive en src/lib/engine.js, donde se puede probar.
  const calculations = useMemo(() => computeBalance({
    assets, liabilities, expenses, familyMembers, macroParams,
    baseCurrency, selectedCountry, exchangeRates,
    euriborPct: euribor ? Number(euribor.ratePct) : null,
    expenseLabel: key => t[`exp_${key}`] || key
  }), [assets, liabilities, expenses, familyMembers, macroParams, baseCurrency, selectedCountry, t, exchangeRates, euribor]);

   const handleResetMacroParams = () => {
    if (!window.confirm(t.confirm_reset_params)) return;
    setMacroParams(DEFAULT_MACRO_PARAMS);
    setAssets(prev => syncAssetRatesToMacro(prev, DEFAULT_MACRO_PARAMS));
  };

      
  const isEquityClass = (a) => ['growth', 'dividend'].includes(stockClassOf(a));

  // Al cambiar de subtipo, las rentabilidades de partida son las del nuevo:
  // un bono que hereda el 6% de revalorización de la bolsa no significa nada.
  const changeStockClass = (stockClass) => {
    const era = isEquityClass(editingAsset);
    let next = { ...editingAsset, stockClass };
    if (stockClass === 'bonds') {
      next = { ...next, stockType: 'fund', cashReturnPct: Number(macroParams.bondYieldPct) || 0, capitalReturnPct: 0 };
    } else if (stockClass === 'tips' || stockClass === 'gold') {
      [next] = syncAssetRatesToMacro([{ ...next, stockType: 'fund' }], macroParams);
    } else if (!era) {
      next = { ...next, cashReturnPct: Number(macroParams.refDividendYieldPct) || 0, capitalReturnPct: macroParams.stockGrowthPct };
    }
    setEditingAsset(next);
  };

  const handleSaveAsset = (e) => {
    e.preventDefault();
    if (!editingAsset.name.trim()) return;

    let assetToSave = { ...editingAsset };

    if (assetToSave.subcategory === 'cash') {
      assetToSave.useReturnPct = 0;
      assetToSave.capitalReturnPct = 0;
    } else if (assetToSave.subcategory === 'stocks') {
      assetToSave.useReturnPct = 0;
      assetToSave.stockClass = stockClassOf(assetToSave);
      // La renta fija y el oro se meten por su valor: no hay acciones que
      // contar ni un ticker de la lista.
      if (!['growth', 'dividend'].includes(assetToSave.stockClass)) assetToSave.stockType = 'fund';
      if (assetToSave.stockType === 'shares') {
        const count = Number(assetToSave.sharesCount) || 0;
        const p = Number(assetToSave.sharePrice) || 0;
        assetToSave.value = Math.round(count * p * 100) / 100;
      } else {
        assetToSave.sharesCount = 0;
        assetToSave.sharePrice = 0;
        assetToSave.market = '';
        assetToSave.ticker = '';
        assetToSave.value = Number(assetToSave.value) || 0;
      }
      if (assetToSave.capitalReturnPct === undefined || assetToSave.capitalReturnPct === '') {
        assetToSave.capitalReturnPct = macroParams.stockGrowthPct;
      }
      // Un bono a vencimiento devuelve lo que costó: su rendimiento es el
      // cupón. La ligada a inflación y el oro siguen a los supuestos.
      if (assetToSave.stockClass === 'bonds') assetToSave.capitalReturnPct = 0;
      if (['tips', 'gold'].includes(assetToSave.stockClass)) {
        [assetToSave] = syncAssetRatesToMacro([assetToSave], macroParams);
      }
    } else if (assetToSave.subcategory === 'pensions') {
      assetToSave.pensionType = pensionTypeOf(assetToSave);
      assetToSave.cashReturnPct = 0;
      assetToSave.useReturnPct = 0;
      assetToSave.capitalReturnPct = Number(assetToSave.capitalReturnPct) || 0;
    } else if (assetToSave.subcategory === 'tangibles') {
      assetToSave.capitalReturnPct = Number(assetToSave.capitalReturnPct) || 0;
      assetToSave.useReturnPct = Number(assetToSave.useReturnPct) || 0;
      assetToSave.cashReturnPct = Number(assetToSave.cashReturnPct) || 0;
    } else if (assetToSave.subcategory === 'real_estate') {
      // El suelo no se alquila ni se habita: un alquiler que quedara de
      // cuando era otro uso no significa nada.
      if (assetToSave.useType === 'land') assetToSave.monthlyRent = 0;
      const returns = calculateRealEstateReturns(
        assetToSave.value,
        assetToSave.monthlyRent,
        assetToSave.useType || 'habitual',
        macroParams
      );
      assetToSave.cashReturnPct = returns.cashReturnPct;
      assetToSave.useReturnPct = returns.useReturnPct;
      assetToSave.capitalReturnPct = returns.capitalReturnPct;
    }

    if (isNewAsset) {
      setAssets([...assets, { ...assetToSave, id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }]);
    } else {
      setAssets(assets.map(a => a.id === assetToSave.id ? assetToSave : a));
    }
    setEditingAsset(null);
  };

  const handleSaveLiability = (e) => {
    e.preventDefault();
    if (!editingLiability.name.trim()) return;

    let liabilityToSave = { ...editingLiability };

if (liabilityToSave.subcategory === 'personal_loans') {
      // Aquí no hay cuadro que reconstruir: el importe es el saldo de hoy y
      // el plazo, lo que falta. Los dos campos del modelo anterior se
      // borran para que no se queden colgando en el fichero guardado.
      delete liabilityToSave.startDate;
      delete liabilityToSave.balanceOverride;
      if (liabilityToSave.rateType !== 'variable') {
        liabilityToSave.rateType = 'fixed';
        delete liabilityToSave.spreadPct;
      }
      const r = resolveLiability(liabilityToSave, new Date(), { euriborPct });
      liabilityToSave.value = r.value;
      liabilityToSave.monthlyPayment = r.monthlyPayment;
      if (liabilityToSave.rateType === 'variable') liabilityToSave.interestRatePct = r.ratePct;
    } else if (liabilityToSave.subcategory === 'mortgages') {
      const p = Number(liabilityToSave.initialPrincipal) || 0;
      const n = Math.round(Number(liabilityToSave.durationMonths));
      // Un diferencial sin tipo variable, o al revés, no tiene sentido:
      // se normaliza aquí para que lo guardado sea siempre coherente.
      if (liabilityToSave.rateType !== 'variable') {
        liabilityToSave.rateType = 'fixed';
        delete liabilityToSave.spreadPct;
      }
      // Un saldo vacío o cero no es un ancla, es la ausencia de una.
      const anchor = Number(liabilityToSave.balanceOverride);
      if (!Number.isFinite(anchor) || anchor <= 0) delete liabilityToSave.balanceOverride;

      if (p > 0 && Number.isFinite(n) && n >= 1) {
        liabilityToSave.durationMonths = n;
        // resolveLiability aplica el tipo efectivo —fijo, o euríbor más
        // diferencial— y respeta el saldo real si se ha escrito uno.
        const r = resolveLiability(liabilityToSave, new Date(), { euriborPct });
        liabilityToSave.value = r.value;
        liabilityToSave.monthlyPayment = r.monthlyPayment;
        // Se guarda el tipo aplicado para que un fichero sin euríbor —o una
        // descarga caída— tenga a qué recurrir.
        if (liabilityToSave.rateType === 'variable') liabilityToSave.interestRatePct = r.ratePct;
      } else if (p > 0) {
        // Sin plazo utilizable dejamos la deuda viva por su principal en
        // lugar de amortizarla en un mes y borrarla del balance.
        liabilityToSave.value = p;
        liabilityToSave.monthlyPayment = 0;
      }
    } else if (liabilityToSave.subcategory === 'family_loans') {
      // Aquí el valor es el saldo que queda hoy: no hay cuadro de
      // amortización ni fecha de inicio de la que partir.
      liabilityToSave.value = Number(liabilityToSave.value) || 0;
      if (liabilityToSave.noMonthlyPayment) {
        liabilityToSave.monthlyPayment = 0;
        delete liabilityToSave.durationMonths;
      } else {
        liabilityToSave.monthlyPayment = Number(liabilityToSave.monthlyPayment) || 0;
      }
    }

    if (isNewLiability) {
      setLiabilities([...liabilities, { ...liabilityToSave, id: 'item_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7) }]);
    } else {
      setLiabilities(liabilities.map(l => l.id === liabilityToSave.id ? liabilityToSave : l));
    }
    setEditingLiability(null);
  };

  const availableTickersForMarket = useMemo(() => {
    if (!editingAsset || !editingAsset.market || editingAsset.market === 'OTRO') return [];
    const marketList = tickersDb[editingAsset.market] || [];
    if (!tickerQuery.trim()) return marketList;
    return marketList.filter(item =>
      item.ticker.toLowerCase().includes(tickerQuery.toLowerCase()) ||
      item.name.toLowerCase().includes(tickerQuery.toLowerCase())
    );
  }, [editingAsset, tickerQuery, tickersDb]);

  // La auditoría se calcula a partir de las cifras del motor, nunca de la
  // interfaz. Devuelve datos; las tarjetas solo los dibujan.
  // Los supuestos se escriben con los valores en vigor, así que se
  // recalculan igual que todo lo demás.
  const assumptions = useMemo(
    () => buildAssumptions({ macroParams, calculations, euribor, formatNumber, lang }),
    [macroParams, calculations, euribor, lang]
  );

  const audit = useMemo(() => buildAudit({
    totalAssets: calculations.totalAssets,
    totalLiabilities: calculations.totalLiabilities,
    netWorth: calculations.netWorth,
    ltv: calculations.ltv,
    liquidCash: calculations.liquidCash,
    runwayMonths: calculations.runwayTotalMonths,
    totalAnnualExpenses: calculations.totalAnnualExpenses,
    totalMonthlyExpenses: calculations.totalMonthlyExpenses,
    monthlyDebtPayments: calculations.monthlyDebtPayments,
    monthlyWealthTax: calculations.monthlyWealthTax,
    monthlyPassiveCashflow: calculations.monthlyPassiveCashflow,
    coveragePct: calculations.coverage.pct,
    assetCategoryTotals: calculations.assetCategoryTotals,
    holdings: assets.map(a => ({ name: a.name, valueBase: toBase(a.value, a.currency) })),
    foreignCurrencyPct: calculations.foreignCurrencyPct,
    expensiveDebt: calculations.expensiveDebt,
    lowYieldPensions: calculations.lowYieldPensions,
    unremuneratedCash: calculations.unremuneratedCash,
    excessExpenses: calculations.excessExpensesList,
    macroParams,
    effectiveSavingsRatePct: calculations.effectiveSavingsRatePct
  }), [calculations, assets, macroParams, baseCurrency, exchangeRates]);

  // Cada mérito trae su unidad desde el motor, así que la frase se rellena
  // sin tener que adivinar si un 40 son euros, meses o por ciento.
  const renderStrength = (st) => {
    const texto = t[`audit_good_${st.id}`];
    if (!texto) return null;
    if (st.value === null || st.value === undefined) return texto;
    const v = st.unit === 'currency' ? formatCurrency(st.value)
      : st.unit === 'pct' ? `${formatNumber(st.value, 1)}%`
      : st.unit === 'months' ? `${formatNumber(st.value, 1)}`
      : st.unit === 'years' ? `${formatNumber(st.value, 1)}`
      : formatNumber(st.value, 0);
    return texto.replace('{value}', v);
  };

  // Convierte una dimensión en una frase. Toma los mismos números que
  // produjeron la nota, así que no puede desincronizarse de ella.
  const renderDimensionReading = (d) => {
    const v = d.unit === 'currency' ? formatCurrency(d.value)
      : d.unit === 'months' ? (d.value === Infinity ? '∞' : `${formatNumber(d.value, 1)} ${t.kpi_months}`)
      : d.unit === 'years' ? `${formatNumber(d.value, 1)} ${t.kpi_years}`
      : d.unit === 'points' ? `${formatNumber(d.value, 0)} ${t.pts}`
      : `${formatNumber(d.value, 1)}%`;

    if (d.id === 'diversification') {
      return t.audit_read_diversification
        .replace('{max}', formatNumber(d.detail.maxCatPct, 1))
        .replace('{holding}', formatNumber(d.detail.largestHoldingPct, 1))
        .replace('{count}', String(d.detail.productiveCount))
        .replace('{fx}', formatNumber(d.detail.foreignCurrencyPct, 1));
    }
    return t[`audit_read_${d.id}`].replace('{value}', v);
  };

  // La mejora concreta que propone cada sección. Sale de la misma fórmula
  // que produjo la nota, así que los puntos prometidos son exactos.
  const renderDimensionAction = (d) => {
    const a = d.action;
    const amount = a.requiredBase != null && a.requiredBase > 0 ? formatCurrency(a.requiredBase) : null;

    switch (a.id) {
      case 'grow_net_worth':
        return t.audit_do_grow_net_worth
          .replace('{amount}', amount || '')
          .replace('{target}', `${formatNumber(a.value, 0)} ${t.kpi_years}`);
      case 'repay_debt':
        return t.audit_do_repay_debt
          .replace('{amount}', amount || '')
          .replace('{target}', `${formatNumber(a.value, 0)}%`);
      case 'add_cash':
        return t.audit_do_add_cash
          .replace('{amount}', amount || '')
          .replace('{target}', `${formatNumber(a.value, 0)} ${t.kpi_months}`);
      case 'add_cashflow':
        return t.audit_do_add_cashflow
          .replace('{amount}', amount || '')
          .replace('{target}', `${formatNumber(a.value, 0)}%`);
      case 'reduce_category_concentration':
        return t.audit_do_reduce_category.replace('{target}', `${formatNumber(a.value, 0)}%`);
      case 'reduce_holding_concentration':
        return t.audit_do_reduce_holding.replace('{target}', `${formatNumber(a.value, 0)}%`);
      case 'add_productive_class':
        return t.audit_do_add_class;
      case 'add_foreign_exposure':
        return t.audit_do_add_fx;
      default:
        // clear_<penalización>: eliminar la fuga más cara
        return t[`audit_do_${a.id}`] + (a.items && a.items.length ? ` (${a.items.join(', ')})` : '');
    }
  };

  const ltvStatus = useMemo(() => {
    if (calculations.ltv < 40) {
      return {
        colorClass: 'text-emerald-700 dark:text-emerald-400 font-bold',
        bgClass: 'bg-emerald-100 text-emerald-950 border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30',
        netWorthBg: isDark ? 'bg-gradient-to-br from-slate-900 via-emerald-950/25 to-slate-900' : 'bg-gradient-to-br from-white via-emerald-50 to-white',
        netWorthBorder: isDark ? 'border-emerald-500/50' : 'border-emerald-500'
      };
    } else if (calculations.ltv <= 60) {
      return {
        colorClass: 'text-amber-700 dark:text-amber-400 font-bold',
        bgClass: 'bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30',
        netWorthBg: isDark ? 'bg-gradient-to-br from-slate-900 via-amber-950/25 to-slate-900' : 'bg-gradient-to-br from-white via-amber-50 to-white',
        netWorthBorder: isDark ? 'border-amber-500/50' : 'border-amber-500'
      };
    } else {
      return {
        colorClass: 'text-rose-700 dark:text-rose-400 font-bold',
        bgClass: 'bg-rose-100 text-rose-950 border-rose-400 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30',
        netWorthBg: isDark ? 'bg-gradient-to-br from-slate-900 via-rose-950/25 to-slate-900' : 'bg-gradient-to-br from-white via-rose-50 to-white',
        netWorthBorder: isDark ? 'border-rose-500/50' : 'border-rose-500'
      };
    }
  }, [calculations.ltv, isDark]);

  const healthScoreStyle = useMemo(() => {
    if (audit.combined < 40) {
      return {
        badge: 'bg-rose-100 border-rose-400 text-rose-900 dark:bg-rose-500/10 dark:border-rose-500/30 dark:text-rose-400'
      };
    } else if (audit.combined <= 75) {
      return {
        badge: 'bg-amber-100 border-amber-400 text-amber-900 dark:bg-amber-500/10 dark:border-amber-500/30 dark:text-amber-400'
      };
    }
    return {
      badge: 'bg-emerald-100 border-emerald-400 text-emerald-900 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-400'
    };
  }, [audit.combined]);

  // Cada estado lleva además un símbolo y un texto: el color por sí solo no
  // es legible para todo el mundo, y en el PDF en blanco y negro no existe.
  const getMilestoneStyle = (status) => {
    if (status === 'green') {
      return {
        container: isDark ? 'bg-emerald-950/20 border-emerald-500/30' : 'bg-emerald-50 border-emerald-300',
        titleText: 'text-emerald-800 dark:text-emerald-400 font-bold',
        metricText: 'text-emerald-800 dark:text-emerald-400 font-bold',
        mark: '✓', markLabel: t.status_reached
      };
    } else if (status === 'yellow') {
      return {
        container: isDark ? 'bg-amber-950/20 border-amber-500/30' : 'bg-amber-50 border-amber-300',
        titleText: 'text-amber-800 dark:text-amber-400 font-bold',
        metricText: 'text-amber-800 dark:text-amber-400 font-bold',
        mark: '◐', markLabel: t.status_partial
      };
    }
    return {
      container: isDark ? 'bg-rose-950/20 border-rose-500/30' : 'bg-rose-50 border-rose-300',
      titleText: 'text-rose-800 dark:text-rose-400 font-bold',
      metricText: 'text-rose-800 dark:text-rose-400 font-bold',
      mark: '○', markLabel: t.status_pending
    };
  };

  const validFamilyMembers = calculations.validFamilyMembers;

  // Escrito con los tokens de marca: ya no hay un color por tema en cada
  // clave, porque el tema lo resuelven las variables CSS. Lo que queda de
  // `isDark` aquí es peso tipográfico y sombra, que en claro hacen falta
  // para separar la tarjeta del fondo y en oscuro sobran.
  const themeClasses = {
    bg: 'bg-brand-bg text-brand-text',
    headerBorder: 'border-brand-border',
    card: `bg-brand-card border-brand-border${isDark ? '' : ' shadow-sm'}`,
    cardInner: 'bg-brand-cardInner border-brand-border',
    subHeader: 'bg-brand-cardInner border-brand-border',
    tableHead: `bg-brand-cardInner text-brand-textMuted border-brand-border${isDark ? '' : ' font-bold'}`,
    tableRowHover: 'hover:bg-brand-cardInner/70',
    tableBorder: 'divide-brand-border/60',
    modalBg: `bg-brand-card border-brand-border text-brand-text${isDark ? '' : ' shadow-2xl'}`,
    // El campo va sobre el fondo de la página, no sobre el de la tarjeta:
    // así se hunde en vez de flotar, que es como se ven en retiro.
    input: `bg-brand-bg border-brand-border text-brand-text focus:border-brand-accent outline-none${isDark ? '' : ' font-semibold shadow-sm'}`,
    textMuted: `text-brand-textMuted${isDark ? '' : ' font-medium'}`,
    textTitle: 'text-brand-text font-bold',
    btnSecondary: 'bg-brand-cardInner hover:bg-brand-border text-brand-text',
    badgePill: `bg-brand-cardInner border-brand-border text-brand-textMuted${isDark ? '' : ' shadow-sm font-semibold'}`,
    stickyColHeader: 'bg-brand-cardInner',
    stickyColRow: 'bg-brand-card group-hover:bg-brand-cardInner'
  };

const shareUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0].split('?')[0] : 'https://patrimonio-os.com';
      const shareText = lang === 'es'
        ? `Calcula tu situación financiera usando ${t.app_title} - ${t.app_subtitle} - ${shareUrl}`
        : `Track your financial health with ${t.app_title} - ${t.app_subtitle} - ${shareUrl}`;

  const handleCopyShareUrl = async () => {
      if (typeof navigator !== 'undefined' && navigator.share) {
        try {
          await navigator.share({
            title: t.app_title,
            text: shareText,
            url: shareUrl
          });
          return;
  } catch (err) {
        if (err.name === 'AbortError') return;
      }
      }
      if (navigator.clipboard) {
        navigator.clipboard.writeText(shareUrl);
        setCopiedNotification(true);
        setTimeout(() => setCopiedNotification(false), 2500);
      }
    };

  return (
    <LocaleContext.Provider value={numberLocale}>
    <TooltipProvider>
      <div className={`min-h-screen w-full max-w-full overflow-x-hidden ${themeClasses.bg} p-3 sm:p-4 md:p-8 font-sans transition-colors duration-200`}>
        {/* Franja del manual, en todos los tamaños y sin forma de cerrarla.
            Va en el flujo de la página y no fija, para no tapar nada; los
            márgenes negativos la llevan hasta el borde por encima del relleno
            de este contenedor. Misma franja que en /retiro (index.css). */}
        <a
          href={MANUAL_URL}
          target="_blank"
          rel="sponsored noopener"
          className="manual-banner no-print -mx-3 -mt-3 sm:-mx-4 sm:-mt-4 md:-mx-8 md:-mt-8 mb-3 sm:mb-4 md:mb-8"
        >
          <span aria-hidden="true">📖</span><span className="manual-banner-text">{t.manual_banner}</span><span aria-hidden="true">→</span>
        </a>
        {/* Cenefa solo en móvil: esto no está pensado para el teléfono (las
            tablas de activos y pasivos son anchas) y el aviso pequeño de antes
            pasaba desapercibido. Cruza la pantalla sin bloquear nada. */}
        <div className="mobile-ribbon no-print" aria-hidden="true"><span>{t.mobile_ribbon}</span></div>

        {/* HEADER */}
        <header className={`max-w-7xl mx-auto flex flex-col md:flex-row justify-between items-start md:items-center pb-5 border-b ${themeClasses.headerBorder} gap-4 w-full`}>
          <div>
            <h1 className={`text-2xl md:text-3xl font-bold tracking-tight ${themeClasses.textTitle} flex items-center gap-3 flex-wrap`}>
              <span className="bg-brand-emerald text-brand-bg px-2 py-0.5 rounded text-sm font-black">FIRE</span>
              <span>{t.app_title}</span>
            </h1>
            <p className={`text-xs sm:text-sm ${themeClasses.textMuted} mt-1 font-sans`}>{t.app_subtitle}</p>
          </div>

          {/* CONTROLES SUPERIORES. Mismas clases, tamaños y orden que la
              cabecera de /retiro: neutros salvo 💾 (verde, guarda) y ♻️ (rojo,
              descarta lo tuyo). El fondo al pasar el ratón es el de retiro,
              que allí sale de slate-800 y de su retoque para el modo claro. */}
          <div className="flex items-center justify-between sm:justify-start w-full sm:w-auto gap-1.5 sm:gap-2 flex-nowrap">
            <span className={`h-12 sm:h-9 items-center text-xs ${themeClasses.badgePill} border px-3 rounded-lg hidden 2xl:inline-flex font-sans whitespace-nowrap flex-shrink-0`}>
              {t.click_to_edit}
            </span>

            <button
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
              aria-label={isDark ? t.theme_light_tt : t.theme_dark_tt}
              title={isDark ? t.theme_light_tt : t.theme_dark_tt}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-card border-brand-border hover:bg-slate-300 dark:hover:bg-slate-800"
            >
              {isDark ? '☀️' : '🌙'}
            </button>

            {/* PDF, guardar y cargar, en el mismo orden que en /retiro.
                Los mismos tres botones siguen estando con su texto en la
                pestaña de Variables; aquí van solo con icono porque en la
                cabecera no cabe más. */}
            <button onClick={handleExportPDF} aria-label={t.tt_header_pdf} title={t.tt_header_pdf} className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-card border-brand-border hover:bg-slate-300 dark:hover:bg-slate-800">
              📄
            </button>
            <button
              onClick={handleExportData}
              aria-label={t.tt_header_save}
              title={t.tt_header_save}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-emerald/20 border-brand-emerald/40 text-brand-emerald hover:bg-brand-emerald/30"
            >
              💾
            </button>
            <button
              onClick={() => fileInputRef.current && fileInputRef.current.click()}
              aria-label={t.tt_header_load}
              title={t.tt_header_load}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-card border-brand-border hover:bg-slate-300 dark:hover:bg-slate-800"
            >
              📂
            </button>
            {/* El mismo «Restaurar datos de ejemplo» de Parámetros, que ya pide
                confirmación: aquí solo cambia dónde está el botón. En rojo, como
                en /retiro: descarta tu trabajo, lo contrario de 💾. */}
            <button
              onClick={handleRestoreSampleData}
              aria-label={t.tt_header_restore}
              title={t.tt_header_restore}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-rose-500/20 border-rose-500/50 text-rose-700 dark:text-rose-400 hover:bg-rose-500/30"
            >
              ♻️
            </button>

            <button
              onClick={() => { setShowFeedbackModal(true); setFeedbackSent(false); }}
              aria-label={t.btn_feedback}
              title={t.btn_feedback}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-card border-brand-border hover:bg-slate-300 dark:hover:bg-slate-800"
            >
              <span>💬</span>
            </button>

            <button
              onClick={() => setShowFaqModal(true)}
              aria-label={t.modal_faq_title}
              title={t.modal_faq_title}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-card border-brand-border hover:bg-slate-300 dark:hover:bg-slate-800"
            >
              <span>❓</span>
            </button>

            <button
              onClick={() => setShowShareModal(true)}
              aria-label={t.modal_share_title || 'Compartir'}
              title={t.modal_share_title || 'Compartir'}
              className="flex-1 basis-0 min-w-0 h-11 sm:flex-none sm:h-9 sm:w-9 text-base sm:text-sm flex items-center justify-center rounded-lg border transition bg-brand-card border-brand-border hover:bg-slate-300 dark:hover:bg-slate-800"
            >
              <span>🔗</span>
            </button>
          </div>
        </header>

        {/* KPIS MACRO */}
        <section className="max-w-7xl mx-auto grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4 my-6">
        <div className={`border p-3.5 sm:p-4 rounded-xl ${themeClasses.card}`}>
            <Tooltip text={t.tt_net_worth}>
              <span className={`text-[11px] sm:text-xs font-bold ${themeClasses.textMuted} uppercase tracking-wider font-sans`}>{t.kpi_net_worth} ⓘ</span>
            </Tooltip>
            <div className={`text-xl sm:text-2xl font-extrabold ${themeClasses.textTitle} mt-1`}>{formatCurrencyCompact(calculations.netWorth)}</div>
            <Tooltip text={t.tt_roe}>
              <span className={`text-[11px] sm:text-xs font-bold font-sans ${calculations.roe < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                {calculations.roe < 0 ? '▼' : '▲'} ROE {formatNumber(calculations.roe)}% {t.kpi_roe_suffix}
              </span>
            </Tooltip>
          </div>

          <div className={`border p-3.5 sm:p-4 rounded-xl ${themeClasses.card}`}>
            <span className={`text-[11px] sm:text-xs font-bold ${themeClasses.textMuted} uppercase tracking-wider font-sans`}>{t.kpi_assets_debt}</span>
            <div className={`text-xl sm:text-2xl font-extrabold ${themeClasses.textTitle} mt-1`}>{formatCurrencyCompact(calculations.totalAssets)}</div>
            <span className={`text-[11px] sm:text-xs ${themeClasses.textMuted} font-sans`}>{t.kpi_debt_label}: <span className="text-brand-text font-semibold">{formatCurrencyCompact(calculations.totalLiabilities)}</span></span>
          </div>

          <div className={`border p-3.5 sm:p-4 rounded-xl ${themeClasses.card}`}>
            <Tooltip text={t.tt_ltv}>
              <span className={`text-[11px] sm:text-xs font-bold ${themeClasses.textMuted} uppercase tracking-wider font-sans`}>{t.kpi_ltv} ⓘ</span>
            </Tooltip>
            <div className={`text-xl sm:text-2xl font-extrabold ${ltvStatus.colorClass} mt-1`}>{formatNumber(calculations.ltv, 1)}%</div>
            <span className={`text-[10px] sm:text-xs font-bold ${ltvStatus.colorClass} font-sans block leading-tight`}>
              {calculations.ltv < 40 ? t.kpi_ltv_healthy : calculations.ltv <= 60 ? t.kpi_ltv_moderate : t.kpi_ltv_high}
            </span>
          </div>

          <div className={`border p-3.5 sm:p-4 rounded-xl ${themeClasses.card}`}>
            <Tooltip text={t.tt_runway}>
              <span className={`text-[11px] sm:text-xs font-bold ${themeClasses.textMuted} uppercase tracking-wider font-sans`}>{t.kpi_runway} ⓘ</span>
            </Tooltip>
            {(() => {
              const val = Number(calculations.runwayTotalMonths) || 0;
              
              // Color coding based on exact unrounded value
              const colorClass = val < 3 
                ? 'text-rose-700 dark:text-rose-400' 
                : val < 6 
                  ? 'text-amber-700 dark:text-amber-400' 
                  : 'text-emerald-700 dark:text-emerald-400';

              // Decimals rule: 2 decimals if between 5.9 and 6.0, otherwise 1 decimal
              const decimals = (val >= 5.9 && val < 6.0) ? 2 : 1;

              return (
              <div className={`text-xl sm:text-2xl font-extrabold ${colorClass} mt-1`}>
                {val === Infinity ? '∞' : formatNumber(val, decimals)} <span className="font-sans text-base sm:text-lg">{t.kpi_months}</span>
              </div>
              );
            })()}
            <span className={`text-[11px] sm:text-xs ${themeClasses.textMuted} font-sans`}><span className="text-brand-text font-semibold">{formatCurrencyCompact(calculations.liquidCash)}</span> {t.kpi_in_liquidity}</span>
            {/* La lectura menos estricta, al lado de la titular y nunca en su lugar. */}
            {calculations.runwaySellableMonths > calculations.runwayTotalMonths && (
              <div className="mt-0.5">
                <Tooltip text={
                  t.tt_runway_sellable
                    .replaceAll('{liquid}', formatCurrency(calculations.liquidSellable))
                    .replaceAll('{interest}', formatCurrency(calculations.monthlyDebtInterest))
                }>
                  <span className={`text-[11px] sm:text-xs ${themeClasses.textMuted} font-sans`}>
                    <span className="text-brand-text font-semibold">
                      {calculations.runwaySellableMonths === Infinity ? '∞' : formatNumber(calculations.runwaySellableMonths, 1)}
                    </span>{' '}
                    {t.kpi_months} {t.kpi_runway_sellable} ⓘ
                  </span>
                </Tooltip>
              </div>
            )}
          </div>
          
        </section>

        {/* BARRA DE PESTAÑAS */}
        <div
          className="max-w-7xl mx-auto flex items-start border-b border-brand-border pb-4 gap-3 text-sm font-semibold mb-6 overflow-x-auto no-scrollbar font-sans tab-scroll-hint"
          role="tablist"
          aria-label={t.app_title}
        >
          {/* Dos grupos, igual que en /retiro y con sus mismas clases: primero
              lo que metes tú, en el orden en que conviene rellenarlo, y después
              lo que la herramienta deduce. Cada grupo lleva su rótulo encima,
              no al lado, que es el formato de retiro. Los rótulos no son
              pestañas. Compartir va al final de Resultados, en azul, porque no
              abre una pestaña sino el modal: se lee como enlace. El rótulo
              lleva leading-5 y retiro no: allí Tailwind 3 hereda los 20 px de
              text-sm y aquí Tailwind 4 hereda un factor, que con 10 px dejaba
              el rótulo más bajo y las pestañas seis píxeles más arriba. */}
          {[
            { group: t.tab_group_data, tabs: [
              { id: 'assets', label: `🏦 ${t.tab_assets} (${formatNumber(assets.length, 0)})` },
              { id: 'liabilities', label: `💳 ${t.tab_liabilities} (${formatNumber(liabilities.length, 0)})` },
              { id: 'expenses', label: `🛒 ${t.tab_expenses}` },
              { id: 'params', label: `⚙️ ${t.tab_params}` }
            ] },
            { group: t.tab_group_results, share: true, tabs: [
              { id: 'net_worth', label: `💎 ${t.tab_net_worth}` },
              { id: 'ai', label: `🔍 ${t.tab_ai}` },
              { id: 'charts', label: `📊 ${t.tab_charts}` }
            ] }
          ].map(({ group, share, tabs }, i) => (
            <Fragment key={group}>
              {i > 0 && <span aria-hidden="true" className="self-stretch w-px bg-brand-border shrink-0 mb-2" />}
              <div className="shrink-0">
                <div aria-hidden="true" className="text-[10px] leading-5 uppercase tracking-wider text-brand-textMuted/70 font-bold whitespace-nowrap select-none mb-1.5">{group}</div>
                <div className="flex gap-3">
                  {tabs.map(tab => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id)}
                      className={`pb-2 whitespace-nowrap transition ${
                        activeTab === tab.id
                          ? 'text-brand-accent border-b-2 border-brand-accent'
                          : 'text-brand-textMuted hover:text-brand-text'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                  {share && (
                    <button
                      onClick={() => setShowShareModal(true)}
                      className="text-brand-accent hover:text-brand-accent/80 transition pb-2 whitespace-nowrap"
                      title={t.modal_share_title}
                    >
                      {`🔗 ${t.btn_share}`}
                    </button>
                  )}
                </div>
              </div>
            </Fragment>
          ))}
        </div>

        {/* CUERPO PRINCIPAL */}
        <main className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6 font-sans w-full">
          <div className="lg:col-span-2 space-y-6 min-w-0 w-full">

{/* PESTAÑA 1: ACTIVOS */}
            {activeTab === 'assets' && (
              <div className="space-y-6">
                <TabHeader
                  icon="🏦"
                  title={t.tab_assets}
                  description={t.desc_assets}
                  isDark={isDark}
                actionButton={
                  <div className="flex items-center gap-2 flex-wrap">
                    {hasSampleData && (
                      <button
                        onClick={handleClearSampleData}
                        className="px-3 py-1.5 bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap"
                        title={t.btn_clear_samples}
                      >
                        <span>{t.btn_clear_samples}</span>
                      </button>
                    )}
                    {assets.length > 0 && (
                      <button
                        onClick={handleDeleteAllAssets}
                        className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap"
                        title={t.btn_delete_all_assets}
                      >
                        <span>{t.btn_delete_all_assets}</span>
                      </button>
                    )}
                  </div>
                }
                />

                {currencyNotice && (
                  <div role="status" className="p-3 rounded-xl text-xs font-bold font-sans flex items-start justify-between gap-3 bg-amber-100 text-amber-950 border border-amber-400 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
                    <span>{t.currency_retired_notice.replace('{list}', describeConversions(currencyNotice))}</span>
                    <button type="button" onClick={() => setCurrencyNotice(null)} aria-label={t.btn_close} className="flex-shrink-0">✕</button>
                  </div>
                )}

                {dataFeedbackMsg && (
                  <div className={`p-3 rounded-xl text-xs font-bold font-sans ${
                    dataFeedbackMsg.type === 'success'
                      ? 'bg-emerald-100 text-emerald-950 border border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
                      : 'bg-amber-100 text-amber-950 border border-amber-400 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'
                  }`}>
                    {dataFeedbackMsg.text}
                  </div>
                )}
                
                <div className="space-y-4">
                  {[
                    { id: 'cash', title: t.sec_cash, typeLabel: t.type_cash },
                    { id: 'stocks', title: t.sec_stocks, typeLabel: t.type_stocks },
                    { id: 'real_estate', title: t.sec_real_estate, typeLabel: t.type_real_estate },
                    { id: 'pensions', title: t.sec_pensions, typeLabel: t.type_pensions },
                    { id: 'tangibles', title: t.sec_tangibles, typeLabel: t.type_tangibles }
                  ].map(sec => {
                    const secAssets = assets.filter(a => a.subcategory === sec.id);
                    const secTotal = secAssets.reduce((sum, a) => sum + toBase(a.value, a.currency), 0);
                    return (
                      <div key={sec.id} className={`border rounded-xl ${themeClasses.card} overflow-hidden`}>
                        <div className={`p-3.5 border-b flex justify-between items-center rounded-t-xl ${themeClasses.subHeader}`}>
                          <h3 className={`font-bold text-xs md:text-sm ${themeClasses.textTitle}`}>
                            {sec.title} <span className="font-normal font-mono opacity-80">({formatCurrency(secTotal)})</span>
                          </h3>
                          <button
                          onClick={() => {
                              setShowTickerDropdown(false);
                              setEditingAsset({
                                name: '',
                                subcategory: sec.id,
                                stockType: 'shares',
                                ...(sec.id === 'stocks' ? { stockClass: 'growth' } : {}),
                                ...(sec.id === 'pensions' ? { pensionType: 'plan' } : {}),
                                market: '',
                                ticker: '',
                                sharesCount: 10,
                                sharePrice: 0,
                                currency: baseCurrency,
                                value: 0,
                                monthlyRent: 0,
                                useType: 'habitual',
                                cashReturnPct: sec.id === 'tangibles' ? -2.5 : sec.id === 'stocks' ? Number(macroParams.refDividendYieldPct) || 0 : 0,
                                useReturnPct: sec.id === 'tangibles' ? 4.0 : 0,
                                capitalReturnPct: sec.id === 'real_estate' ? macroParams.inflationPct : sec.id === 'stocks' ? macroParams.stockGrowthPct : sec.id === 'tangibles' ? -10.0 : 0
                              });
                              setTickerQuery('');
                              setIsNewAsset(true);
                            }}
                            className="text-xs text-brand-accent hover:underline font-bold px-2 py-1 rounded transition"
                          >
                            {t.btn_add}
                          </button>
                        </div>
                        <div className="overflow-x-auto w-full">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className={`border-b ${themeClasses.tableHead}`}>
                              <tr>
                                <th scope="col" className="p-2.5 w-10 text-center font-sans">#</th>
                                <th scope="col" className={`p-2.5 font-sans sticky left-0 z-10 ${themeClasses.stickyColHeader} border-r ${themeClasses.headerBorder} whitespace-nowrap min-w-[140px] md:min-w-0`}>
                                  {t.col_name}
                                </th>
                                {sec.id === 'real_estate' && <th className="p-2.5 text-center font-sans whitespace-nowrap px-3">{t.col_use_type}</th>}
                                {(sec.id === 'stocks' || sec.id === 'pensions') && <th className="p-2.5 text-center font-sans whitespace-nowrap px-3">{t.col_subtype}</th>}
                                <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">{t.col_value}</th>
                                
                                {sec.id !== 'pensions' && (
                                  <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">
                                    <Tooltip text={sec.id === 'real_estate' ? t.tt_cash_return_re : t.tt_cash_return}>{t.col_cash_pct} ⓘ</Tooltip>
                                  </th>
                                )}

                                {sec.id !== 'pensions' && (
                                  <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">
                                    <Tooltip text={t.tt_cash_amount}>{t.col_cash_amount} ⓘ</Tooltip>
                                  </th>
                                )}

                                {(sec.id === 'real_estate' || sec.id === 'tangibles') && (
                                  <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">
                                    <Tooltip text={sec.id === 'tangibles' ? t.tt_use_return_tangibles : t.tt_use_return}>{t.col_use_pct} ⓘ</Tooltip>
                                  </th>
                                )}

                                {sec.id !== 'cash' && (
                                  <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">
                                    <Tooltip text={t.tt_cap_return}>{t.col_cap_pct} ⓘ</Tooltip>
                                  </th>
                                )}
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${themeClasses.tableBorder}`}>
                              {secAssets.length === 0 ? (
                                <tr>
                                  <td 
                                    colSpan={
                                      sec.id === 'real_estate' ? 8 :
                                      sec.id === 'tangibles' ? 7 :
                                      sec.id === 'stocks' ? 7 :
                                      sec.id === 'cash' ? 5 : 5
                                    } 
                                    className={`p-3 text-center ${themeClasses.textMuted} italic font-sans`}
                                  >
                                    {t.col_no_items}
                                  </td>
                                </tr>
                              ) : (
                                secAssets.map((a, aIdx) => {
                                  const cashReturnAmount = Math.round(assetAnnualCashflow(a, macroParams, calculations.effectiveSavingsRatePct).net);
                                  return (
                                    <tr
                                      key={a.id}
                                      className={`group ${themeClasses.tableRowHover}`}
                                    >
                                      {/* Up / Down Controls */}
                                      <td className="p-1 text-center whitespace-nowrap w-10">
                                        <div className="flex items-center justify-center gap-0.5 opacity-60 group-hover:opacity-100">
                                         <button
                                          type="button"
                                          aria-label="Subir elemento"
                                          disabled={aIdx === 0}
                                          onClick={() => moveAsset(aIdx, -1, sec.id)}
                                          className="px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-20 text-[10px]"
                                        >
                                          ▲
                                        </button>
                                        <button
                                          type="button"
                                          aria-label="Bajar elemento"
                                          disabled={aIdx === secAssets.length - 1}
                                          onClick={() => moveAsset(aIdx, 1, sec.id)}
                                          className="px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-20 text-[10px]"
                                        >
                                          ▼
                                        </button>
                                        </div>
                                      </td>
                                      <td 
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`${t.modal_edit_prefix} ${a.name}`}
                                        onClick={() => {
                                          setEditingAsset(a);
                                          setTickerQuery(a.ticker || '');
                                          setIsNewAsset(false);
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setEditingAsset(a);
                                            setTickerQuery(a.ticker || '');
                                            setIsNewAsset(false);
                                          }
                                        }}
                                        className={`p-2.5 font-bold ${themeClasses.textTitle} font-sans sticky left-0 z-10 ${themeClasses.stickyColRow} border-r ${themeClasses.headerBorder} whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-brand-accent focus:ring-inset`}
                                        title={t.click_to_edit}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <span className="flex-shrink-0">✏️</span>
                                          <span>{a.name}</span>
                                        </div>
                                      </td>
                                      {sec.id === 'real_estate' && (
                                        <td 
                                          onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                          className="p-2.5 text-center font-sans whitespace-nowrap px-3 cursor-pointer"
                                        >
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block whitespace-nowrap ${
                                            a.useType === 'habitual' ? 'bg-sky-100 text-sky-950 border border-sky-300 dark:bg-sky-500/10 dark:text-sky-300 dark:border-sky-500/20' :
                                            a.useType === 'rented' ? 'bg-emerald-100 text-emerald-950 border border-emerald-300 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/20' :
                                            'bg-amber-100 text-amber-950 border border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/20'
                                          }`}>
                                            {USE_TYPE_LABEL[a.useType] || t.use_vacant}
                                          </span>
                                        </td>
                                      )}
                                      {(sec.id === 'stocks' || sec.id === 'pensions') && (
                                        <td
                                          onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                          className="p-2.5 text-center font-sans whitespace-nowrap px-3 cursor-pointer"
                                        >
                                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold inline-block whitespace-nowrap ${themeClasses.cardInner}`}>
                                            {sec.id === 'stocks' ? STOCK_CLASS_LABEL[stockClassOf(a)] : PENSION_TYPE_LABEL[pensionTypeOf(a)]}
                                          </span>
                                        </td>
                                      )}
                                      <td 
                                        onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                        className={`p-2.5 text-right font-mono font-bold whitespace-nowrap px-3 ${themeClasses.textTitle} cursor-pointer`}
                                      >
                                        <div>{formatCurrency(a.value, a.currency)}</div>
                                        {a.currency && a.currency !== baseCurrency && (
                                          <div className="text-[10px] text-slate-500 font-normal">
                                            ≈ {formatCurrency(toBase(a.value, a.currency), baseCurrency)}
                                          </div>
                                        )}
                                      </td>
                                      
                                {sec.id !== 'pensions' && (
                                  <td 
                                    onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                    className={`p-2.5 text-right font-mono font-bold whitespace-nowrap px-3 cursor-pointer ${
                                      Number(a.cashReturnPct || 0) < 0 
                                        ? 'text-rose-700 dark:text-rose-400' 
                                        : 'text-emerald-700 dark:text-emerald-400'
                                    }`}
                                  >
                                    {formatNumber(a.cashReturnPct)}%
                                  </td>
                                )}

                                  {sec.id !== 'pensions' && (
                                  <td 
                                    onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                    className={`p-2.5 text-right font-mono font-bold whitespace-nowrap px-3 cursor-pointer ${
                                      cashReturnAmount < 0 
                                        ? 'text-rose-700 dark:text-rose-400' 
                                        : 'text-emerald-700 dark:text-emerald-400'
                                    }`}
                                  >
                                    <div>{formatCurrency(cashReturnAmount, a.currency)}</div>
                                    {a.currency && a.currency !== baseCurrency && (
                                      <div className="text-[10px] opacity-70 font-normal font-mono">
                                        ≈ {formatCurrency(toBase(cashReturnAmount, a.currency), baseCurrency)}
                                      </div>
                                    )}
                                  </td>
                                )}

                                      {(sec.id === 'real_estate' || sec.id === 'tangibles') && (
                                        <td 
                                          onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                          className="p-2.5 text-right text-sky-700 dark:text-sky-400 font-mono font-bold whitespace-nowrap px-3 cursor-pointer"
                                        >
                                          {formatNumber(a.useReturnPct)}%
                                        </td>
                                      )}

                                      {sec.id !== 'cash' && (
                                        <td 
                                          onClick={() => { setEditingAsset(a); setTickerQuery(a.ticker || ''); setIsNewAsset(false); }}
                                          className="p-2.5 text-right text-purple-700 dark:text-purple-400 font-mono font-bold whitespace-nowrap px-3 cursor-pointer"
                                        >
                                          {formatNumber(a.capitalReturnPct)}%
                                        </td>
                                      )}
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* TOTALES ACTIVOS */}
                <div className={`border border-emerald-500/30 rounded-2xl p-5 shadow-lg space-y-4 ${isDark ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-emerald-950/30' : 'bg-gradient-to-br from-white via-emerald-50 to-white'}`}>
                  <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b ${themeClasses.headerBorder} pb-3`}>
                    <div>
                      <span className="text-xs uppercase font-bold text-emerald-700 dark:text-emerald-400 tracking-wider font-sans">{t.card_assets_summary}</span>
                      <h4 className={`text-lg font-extrabold ${themeClasses.textTitle} font-sans`}>
                        {t.total_assets_label}: <span className="font-mono whitespace-nowrap">{formatCurrency(calculations.totalAssets)}</span>
                      </h4>
                    </div>
                    <div className={`text-xs ${themeClasses.textMuted} font-sans`}>
                      {t.gross_return_label}: <strong className={`${themeClasses.textTitle} font-bold font-mono`}>{formatNumber(calculations.totalGrossReturnPct)}%</strong> (<span className="font-mono">{formatCurrency(calculations.totalGrossReturnBase)}</span> {t.per_year})
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_cash_return}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.cash_return_title} ⓘ</span>
                      </Tooltip>
                          <div className={`text-base font-bold font-mono ${
                            calculations.weightedCashPct < 0 
                              ? 'text-rose-700 dark:text-rose-400' 
                              : 'text-emerald-700 dark:text-emerald-400'
                          }`}>
                            {formatNumber(calculations.weightedCashPct)}% <span className={`text-xs font-normal ${themeClasses.textMuted} font-sans`}>{t.weighted_suffix}</span>
                          </div>  
                          <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>
                        {calculations.cashRetBase >= 0 ? '+' : ''}<span className="font-mono text-slate-900 dark:text-slate-200">{formatCurrency(calculations.cashRetBase)}</span> {t.per_year}
                      </span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_use_return}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.use_return_title} ⓘ</span>
                      </Tooltip>
                      <div className="text-base font-bold text-sky-700 dark:text-sky-400 font-mono">{formatNumber(calculations.weightedUsePct)}% <span className={`text-xs font-normal ${themeClasses.textMuted} font-sans`}>{t.weighted_suffix}</span></div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.use_return_equivalent} <span className="font-mono text-slate-900 dark:text-slate-200">{formatCurrency(calculations.useRetBase)}</span> {t.per_year}</span>                        </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_cap_return}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.cap_return_title} ⓘ</span>
                      </Tooltip>
                      <div className="text-base font-bold text-purple-700 dark:text-purple-400 font-mono">{formatNumber(calculations.weightedCapPct)}% <span className={`text-xs font-normal ${themeClasses.textMuted} font-sans`}>{t.weighted_suffix}</span></div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>
                        {calculations.capGrowthBase >= 0 ? '+' : ''}<span className="font-mono text-slate-900 dark:text-slate-200">{formatCurrency(calculations.capGrowthBase)}</span> {t.per_year}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 2: PASIVOS (DEUDA) */}
            {activeTab === 'liabilities' && (
              <div className="space-y-6">
                <TabHeader
                  icon="💳"
                  title={t.tab_liabilities}
                  description={t.desc_liabilities}
                  isDark={isDark}
                actionButton={
                    liabilities.length > 0 && (
                      <button
                        onClick={handleDeleteAllDebts}
                        className="px-3 py-1.5 bg-rose-500/10 border border-rose-500/30 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 rounded-lg text-xs font-semibold transition flex items-center gap-1.5 whitespace-nowrap"
                        title={t.btn_delete_all_debts}
                      >
                        <span>{t.btn_delete_all_debts}</span>
                      </button>
                    )
                  }
                />
                
                <div className="space-y-4">
{[
                    { id: 'short_term', title: t.sec_short_term, typeLabel: t.type_short_term, isAmortized: false },
                    { id: 'personal_loans', title: t.sec_personal_loans, typeLabel: t.type_personal_loans, showsRemaining: true },
                    { id: 'family_loans', title: t.sec_family_loans, typeLabel: t.type_family_loans, isFamily: true },
                    { id: 'mortgages', title: t.sec_mortgages, typeLabel: t.type_mortgages, isAmortized: true }
                  ].map(sec => {
                    const secLiabs = liabilities.filter(l => l.subcategory === sec.id);
                    const secTotal = secLiabs.reduce((sum, l) => {
                      return sum + toBase(resolveLiability(l, new Date(), { euriborPct }).value, l.currency);
                    }, 0);
                    return (
                      <div key={sec.id} className={`border rounded-xl ${themeClasses.card} overflow-hidden`}>
                        <div className={`p-3.5 border-b flex justify-between items-center rounded-t-xl ${themeClasses.subHeader}`}>
                          <h3 className={`font-bold text-xs md:text-sm ${themeClasses.textTitle}`}>
                            {sec.title} <span className="font-normal font-mono opacity-80">({formatCurrency(secTotal)})</span>
                          </h3>
                          <button
                            onClick={() => {
                              setEditingLiability({
                                name: '',
                                subcategory: sec.id,
                                currency: baseCurrency,
                                initialPrincipal: sec.isAmortized ? 50000 : sec.showsRemaining ? 8000 : sec.isFamily ? 10000 : 1500,
                                startDate: '2023-01',
                                durationMonths: sec.id === 'mortgages' ? 300 : sec.id === 'personal_loans' ? 48 : 36,
                                value: sec.isAmortized ? 50000 : sec.showsRemaining ? 8000 : sec.isFamily ? 10000 : 1500,
                                interestRatePct: sec.id === 'mortgages' ? 2.4 : sec.id === 'personal_loans' ? 4.9 : 0.0,
                                monthlyPayment: sec.isFamily ? 300 : 100
                              });
                              setIsNewLiability(true);
                            }}
                            className="text-xs text-rose-700 dark:text-rose-400 hover:underline font-bold px-2 py-1 rounded transition font-sans"
                          >
                            {t.btn_add}
                          </button>
                        </div>
                        <div className="overflow-x-auto w-full">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead className={`border-b ${themeClasses.tableHead}`}>
                              <tr>
                                <th scope="col" className="p-2.5 w-10 text-center font-sans">#</th>
                                <th scope="col" className={`p-2.5 font-sans sticky left-0 z-10 ${themeClasses.stickyColHeader} border-r ${themeClasses.headerBorder} whitespace-nowrap min-w-[140px] md:min-w-0`}>
                                  {t.col_name}
                                </th>
                                {sec.isAmortized && <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">{t.col_original_loan}</th>}
                                {sec.isAmortized && <th className="p-2.5 text-center font-sans whitespace-nowrap px-3">{t.col_start_date}</th>}
                                {(sec.isFamily || sec.showsRemaining) && <th className="p-2.5 text-center font-sans whitespace-nowrap px-3">{t.col_duration}</th>}
                                <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">{t.col_pending_balance}</th>
                                <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">{t.col_interest_pct}</th>
                                <th className="p-2.5 text-right font-sans whitespace-nowrap px-3">{t.col_monthly_payment}</th>
                              </tr>
                            </thead>
                            <tbody className={`divide-y ${themeClasses.tableBorder}`}>
                              {secLiabs.length === 0 ? (
                                <tr>
                                  <td colSpan={sec.isAmortized ? 7 : sec.isFamily || sec.showsRemaining ? 6 : 5} className={`p-3 text-center ${themeClasses.textMuted} italic font-sans`}>{t.col_no_items}</td>
                                </tr>
                              ) : (
                                secLiabs.map((l, lIdx) => {
                                  const { value: currentVal, monthlyPayment: currentMonthly } = resolveLiability(l, new Date(), { euriborPct });
                                  return (
                                    <tr
                                      key={l.id}
                                      className={`group ${themeClasses.tableRowHover}`}
                                    >
                                      {/* Up / Down Controls */}
                                      <td className="p-1 text-center whitespace-nowrap w-10">
                                        <div className="flex items-center justify-center gap-0.5 opacity-60 group-hover:opacity-100">
                                         <button
                                          type="button"
                                          aria-label="Subir deuda"
                                          disabled={lIdx === 0}
                                          onClick={() => moveLiability(lIdx, -1, sec.id)}
                                          className="px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-20 text-[10px]"
                                        >
                                          ▲
                                        </button>
                                        <button
                                          type="button"
                                          aria-label="Bajar deuda"
                                          disabled={lIdx === secLiabs.length - 1}
                                          onClick={() => moveLiability(lIdx, 1, sec.id)}
                                          className="px-1 py-0.5 hover:bg-slate-200 dark:hover:bg-slate-700 rounded disabled:opacity-20 text-[10px]"
                                        >
                                          ▼
                                        </button>
                                        </div>
                                      </td>
                                      <td 
                                        role="button"
                                        tabIndex={0}
                                        aria-label={`${t.modal_edit_prefix} ${l.name}`}
                                        onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter' || e.key === ' ') {
                                            e.preventDefault();
                                            setEditingLiability(l);
                                            setIsNewLiability(false);
                                          }
                                        }}
                                        className={`p-2.5 font-bold ${themeClasses.textTitle} font-sans sticky left-0 z-10 ${themeClasses.stickyColRow} border-r ${themeClasses.headerBorder} whitespace-nowrap cursor-pointer focus:outline-none focus:ring-2 focus:ring-rose-500 focus:ring-inset`}
                                        title={t.click_to_edit}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <span className="flex-shrink-0">✏️</span>
                                          <span>{l.name}</span>
                                        </div>
                                      </td>
                                      {sec.isAmortized && (
                                        <td 
                                          onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                          className={`p-2.5 text-right font-mono font-medium whitespace-nowrap px-3 ${themeClasses.textMuted} cursor-pointer`}
                                        >
                                          {l.initialPrincipal ? formatCurrency(l.initialPrincipal, l.currency) : '-'}
                                        </td>
                                      )}
                                      {sec.isAmortized && (
                                        <td 
                                          onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                          className={`p-2.5 text-center font-mono font-medium whitespace-nowrap px-3 ${themeClasses.textMuted} cursor-pointer`}
                                        >
                                          {l.startDate ? `${l.startDate} (${formatNumber(l.durationMonths, 0)}m)` : '-'}
                                        </td>
                                      )}
                                      {(sec.isFamily || sec.showsRemaining) && (
                                        <td 
                                          onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                          className={`p-2.5 text-center font-sans font-medium whitespace-nowrap px-3 ${themeClasses.textMuted} cursor-pointer`}
                                        >
                                          {l.noMonthlyPayment || !l.durationMonths
                                            ? '—'
                                            : `${formatNumber(l.durationMonths, 0)} ${t.kpi_months}`}
                                        </td>
                                      )}
                                      <td 
                                        onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                        className={`p-2.5 text-right font-mono font-bold whitespace-nowrap px-3 ${themeClasses.textTitle} cursor-pointer`}
                                      >
                                        {formatCurrency(currentVal, l.currency)}
                                      </td>
                                      <td 
                                        onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                        className="p-2.5 text-right text-rose-700 dark:text-rose-400 font-mono font-bold whitespace-nowrap px-3 cursor-pointer"
                                      >
                                        {formatNumber(l.interestRatePct)}%
                                      </td>
                                      <td 
                                        onClick={() => { setEditingLiability(l); setIsNewLiability(false); }}
                                        className={`p-2.5 text-right font-mono font-bold whitespace-nowrap px-3 cursor-pointer ${l.noMonthlyPayment ? 'text-brand-amber' : 'text-rose-700 dark:text-rose-400'}`}
                                      >
                                        {l.noMonthlyPayment
                                          ? <span className="font-sans text-[11px]">{t.no_monthly_payment_short}</span>
                                          : <>-{formatCurrency(currentMonthly, l.currency)}{t.per_month_short}</>}
                                      </td>
                                    </tr>
                                  );
                                })
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* TOTALES PASIVOS */}
                <div className={`border border-rose-500/30 rounded-2xl p-5 shadow-lg space-y-4 ${isDark ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-rose-950/30' : 'bg-gradient-to-br from-white via-rose-50 to-white'}`}>
                  <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b ${themeClasses.headerBorder} pb-3`}>
                    <div>
                      <span className="text-xs uppercase font-bold text-rose-700 dark:text-rose-400 tracking-wider font-sans">{t.card_liabilities_summary}</span>
                      <h4 className={`text-lg font-extrabold ${themeClasses.textTitle} font-sans`}>
                        {t.total_debt_label}: <span className="font-mono whitespace-nowrap">{formatCurrency(calculations.totalLiabilities)}</span>
                      </h4>
                    </div>
                    <div className={`text-xs ${themeClasses.textMuted} font-sans`}>
                      {t.weighted_interest_label}: <strong className="text-rose-700 dark:text-rose-400 font-bold font-mono">{formatNumber(calculations.weightedInterestPct)}%</strong>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.monthly_debt_title}</span>
                      <div className="text-base font-bold text-rose-700 dark:text-rose-400 font-mono">-{formatCurrency(Math.abs(calculations.monthlyDebtPayments))}{t.per_month_short}</div>
                          <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>-<span className="font-mono text-slate-900 dark:text-slate-200">{formatCurrency(Math.abs(calculations.annualDebtPayments))}</span> {t.per_year}</span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.annual_interest_cost}</span>
                      <div className="text-base font-bold text-rose-700 dark:text-rose-400 font-mono">-{formatCurrency(calculations.debtInterestBase)} {t.per_year}</div>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_ltv}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.ltv_title} ⓘ</span>
                      </Tooltip>
                      <div className={`text-base font-bold ${ltvStatus.colorClass} font-mono`}>{formatNumber(calculations.ltv, 1)}%</div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.ltv_subtitle}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 3: PATRIMONIO NETO */}
            {activeTab === 'net_worth' && (
              <div className="space-y-6">
                <TabHeader icon="💎" title={t.tab_net_worth} description={t.desc_net_worth} isDark={isDark} />
                
                {/* 1. Activos */}
                <div className={`border rounded-xl p-4 ${themeClasses.card}`}>
                  <div className="flex justify-between items-center gap-4 mb-3">
                    <span className="text-xs uppercase font-bold text-emerald-700 dark:text-emerald-400 font-sans flex-1">1. {t.card_assets_summary}</span>
                    <span className="text-sm font-extrabold text-emerald-700 dark:text-emerald-400 font-mono whitespace-nowrap flex-shrink-0 text-right">{formatCurrency(calculations.totalAssets)}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className={`p-2 rounded border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} text-[10px] block font-bold font-sans`}>{t.cash_return_title}</span>
                      <span className={`font-mono font-bold ${
                        calculations.cashRetBase < 0 
                          ? 'text-rose-700 dark:text-rose-400' 
                          : 'text-emerald-700 dark:text-emerald-400'
                      }`}>
                        {formatCurrency(calculations.cashRetBase)} {t.per_year} ({formatNumber(calculations.weightedCashPct)}%)
                      </span>
                    </div>
                    <div className={`p-2 rounded border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} text-[10px] block font-bold font-sans`}>{t.use_return_title}</span>
                      <span className="font-mono text-sky-700 dark:text-sky-400 font-bold">{t.use_return_equivalent} {formatCurrency(calculations.useRetBase)} {t.per_year} ({formatNumber(calculations.weightedUsePct)}%)</span>                        </div>
                    <div className={`p-2 rounded border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} text-[10px] block font-bold font-sans`}>{t.cap_return_title}</span>
                      <span className="font-mono text-purple-700 dark:text-purple-400 font-bold">{formatCurrency(calculations.capGrowthBase)} {t.per_year} ({formatNumber(calculations.weightedCapPct)}%)</span>
                    </div>
                  </div>
                </div>

                {/* 2. Pasivos */}
                <div className={`border rounded-xl p-4 ${themeClasses.card}`}>
                  <div className="flex justify-between items-center gap-4 mb-3">
                    <span className="text-xs uppercase font-bold text-rose-700 dark:text-rose-400 font-sans flex-1">2. {t.card_liabilities_summary}</span>
                    <span className="text-sm font-extrabold text-rose-700 dark:text-rose-400 font-mono whitespace-nowrap flex-shrink-0 text-right">{formatCurrency(calculations.totalLiabilities)}</span>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                    <div className={`p-2 rounded border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} text-[10px] block font-bold font-sans`}>{t.monthly_debt_title}</span>
                      <span className="font-mono text-rose-700 dark:text-rose-400 font-bold">-{formatCurrency(calculations.monthlyDebtPayments)}{t.per_month_short}</span>
                    </div>
                    <div className={`p-2 rounded border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} text-[10px] block font-bold font-sans`}>{t.annual_interest_cost}</span>
                      <span className="font-mono text-rose-700 dark:text-rose-400 font-bold">-{formatCurrency(calculations.debtInterestBase)} {t.per_year}</span>
                    </div>
                    <div className={`p-2 rounded border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} text-[10px] block font-bold font-sans`}>{t.weighted_interest_label}</span>
                      <span className={`font-mono ${themeClasses.textTitle} font-bold`}>{formatNumber(calculations.weightedInterestPct)}%</span>
                    </div>
                  </div>
                </div>

                {/* 3. Caja de Patrimonio Neto */}
                <div className={`border-2 ${ltvStatus.netWorthBorder} ${ltvStatus.netWorthBg} rounded-2xl p-4 sm:p-6 shadow-xl space-y-4`}>
                  <div className={`flex flex-col sm:flex-row justify-between items-start sm:items-center gap-2 border-b ${themeClasses.headerBorder} pb-3`}>
                    <div>
                      <div className="flex items-center gap-2 font-sans flex-wrap">
                        <span className={`text-xs uppercase font-black tracking-widest ${ltvStatus.colorClass}`}>{t.net_worth_card_title}</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${ltvStatus.bgClass}`}>
                          LTV {formatNumber(calculations.ltv, 1)}% {calculations.ltv < 40 ? t.ltv_healthy_short : calculations.ltv <= 60 ? t.ltv_moderate_short : t.ltv_high_short}
                        </span>
                      </div>
                      <h2 className={`text-2xl sm:text-3xl font-black ${themeClasses.textTitle} mt-0.5 font-mono whitespace-nowrap`}>{formatCurrency(calculations.netWorth)}</h2>
                      {/* El patrimonio neto es lo que vale el balance sobre el
                          papel; esto es lo que llegaría a la cuenta. Va debajo y
                          nunca en su lugar. */}
                      {calculations.totalAssets > 0 && (
                        <Tooltip text={
                          t.tt_liq
                            .replaceAll('{gap}', formatCurrency(calculations.netWorth - calculations.liquidationValue))
                            .replaceAll('{tax}', formatCurrency(calculations.capitalGainsTax))
                            .replaceAll('{gain}', formatCurrency(calculations.totalCapitalGain))
                            .replaceAll('{fee}', formatCurrency(calculations.debtCancellationCost - calculations.totalLiabilities))
                        }>
                          <span className={`text-[11px] sm:text-xs ${themeClasses.textMuted} font-sans mt-0.5`}>
                            {t.liq_title}:{' '}
                            <span className="font-mono text-slate-950 dark:text-slate-200">{formatCurrency(calculations.liquidationValue)}</span>
                            {' '}ⓘ
                          </span>
                        </Tooltip>
                      )}
                    </div>
                  </div>

                  <p className={`text-xs ${themeClasses.textMuted} italic font-sans`}>{t.net_worth_formula}</p>

                  {/* Fila 1: Métricas Integrales (con retorno por Uso) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-2">
                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_net_annual_return}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.net_annual_return_label} ⓘ</span>
                      </Tooltip>
                      <div className={`text-lg font-black font-mono ${calculations.netReturnBase < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {calculations.netReturnBase > 0 ? '+' : ''}{formatCurrency(calculations.netReturnBase)} <span className="text-xs font-normal font-sans">{t.per_year}</span>
                      </div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.net_annual_return_sub}</span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_roe}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.roe_label} ⓘ</span>
                      </Tooltip>
                      <div className="text-lg font-black text-sky-700 dark:text-sky-400 font-mono">{formatNumber(calculations.roe)}%</div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.roe_sub}</span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_roa}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.roa_label} ⓘ</span>
                      </Tooltip>
                      <div className="text-lg font-black text-purple-700 dark:text-purple-400 font-mono">{formatNumber(calculations.roa)}%</div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.roa_sub}</span>
                    </div>
                  </div>

                  {/* Fila 2: Métricas Financieras Puras (sin retorno por Uso) */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs pt-1">
                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_net_annual_financial_return}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.net_annual_financial_return_label} ⓘ</span>
                      </Tooltip>
                      <div className={`text-lg font-black font-mono ${calculations.netFinancialReturnBase < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                        {calculations.netFinancialReturnBase > 0 ? '+' : ''}{formatCurrency(calculations.netFinancialReturnBase)} <span className="text-xs font-normal font-sans">{t.per_year}</span>
                      </div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.net_annual_financial_return_sub}</span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_roe_financial}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.roe_financial_label} ⓘ</span>
                      </Tooltip>
                      <div className="text-lg font-black text-sky-700 dark:text-sky-400 font-mono">{formatNumber(calculations.roeFinancial)}%</div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.roe_financial_sub}</span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <Tooltip text={t.tt_roa_financial}>
                        <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.roa_financial_label} ⓘ</span>
                      </Tooltip>
                      <div className="text-lg font-black text-purple-700 dark:text-purple-400 font-mono">{formatNumber(calculations.roaFinancial)}%</div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>{t.roa_financial_sub}</span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 4: GASTOS FAMILIARES */}
            {activeTab === 'expenses' && (
              <div className="space-y-6">
                <TabHeader icon="🛒" title={t.tab_expenses} description={t.desc_expenses} isDark={isDark} />
                {expensesSample && COUNTRY_PRESETS[expensesSample] && (
                  <div role="status" className="p-3 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 text-xs font-semibold font-sans flex items-start gap-2">
                    <span aria-hidden="true">⚠️</span>
                    <span>{t.expenses_sample_banner.replace('{country}', COUNTRY_PRESETS[expensesSample][`name_${lang}`])}</span>
                  </div>
                )}
                <div className={`border p-4 sm:p-5 rounded-xl space-y-6 ${themeClasses.card}`}>
                  <div className={`flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 p-3 rounded-xl border ${themeClasses.cardInner}`}>
                    <div className="flex flex-col sm:flex-row flex-1 sm:items-center gap-2 font-sans">
                      <label className={`text-xs font-bold whitespace-nowrap ${themeClasses.textTitle}`}>{t.country_ref}:</label>
                      <div className="flex items-center gap-2 flex-1 w-full min-w-0">
                        <select
                          value={selectedCountry}
                          onChange={e => setSelectedCountry(e.target.value)}
                          className={`flex-1 min-w-0 border rounded-lg p-1.5 text-xs outline-none font-sans truncate ${themeClasses.input}`}
                        >
                          {Object.entries(COUNTRY_PRESETS).map(([k, v]) => (
                            <option key={k} value={k}>{lang === 'es' ? v.name_es : v.name_en}</option>
                          ))}
                        </select>
                        <button
                          onClick={applyCountryPreset}
                          className="bg-brand-emerald hover:bg-emerald-400 text-slate-950 font-bold text-xs px-3 py-1.5 rounded-lg transition shadow-md whitespace-nowrap flex-shrink-0 font-sans"
                        >
                          {t.btn_autofill}
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-start gap-2 font-sans pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-200 dark:border-slate-800">
                      <label className={`text-xs ${themeClasses.textMuted} whitespace-nowrap`}>{t.family_members}:</label>
                    <input
                        type="number"
                        min="1"
                        value={familyMembers === '' ? '' : familyMembers}
                        onChange={e => {
                          const val = e.target.value;
                          // Cuántos sois también es dato propio: la media ya no es la cesta de ejemplo.
                          setExpensesSample(null);
                          if (val === '') {
                            setFamilyMembers('');
                          } else {
                            const n = parseInt(val, 10);
                            if (!isNaN(n)) setFamilyMembers(Math.max(1, n));
                          }
                        }}
                        onBlur={() => {
                          if (!familyMembers || familyMembers < 1) setFamilyMembers(1);
                        }}
                        className={`w-14 border rounded-lg p-1.5 text-xs font-mono text-center outline-none ${themeClasses.input}`}
                      />
                    </div>
                  </div>

                  {/* 1. MENSUALES POR PERSONA */}
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center pb-1.5 gap-1 font-sans">
                      <h4 className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider text-left">{t.exp_group_person_monthly}</h4>
                      <span className={`text-[11px] font-bold ${themeClasses.textMuted} text-left sm:text-right`}>
                        Subtotal: <span className="font-mono text-slate-950 dark:text-slate-200">{formatCurrency(calculations.sumPersonMonthly * (Number(familyMembers) || 1))}</span>{t.per_month_short} ({formatNumber(Math.max(1, Number(familyMembers) || 1), 0)} {t.people_short} × <span className="font-mono text-slate-900 dark:text-slate-200">{formatCurrency(calculations.sumPersonMonthly)}</span>{t.per_month_short})                         
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-xs">
                      {Object.entries(expenses.person_monthly || {}).map(([key, val]) => (
                        <div key={key} className="flex flex-col gap-1">
                          <label className={`text-[11px] ${themeClasses.textMuted} truncate font-bold font-sans`}>{t[`exp_${key}`] || key}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={val}
                              onChange={newVal => editExpenses({
                                ...expenses,
                                person_monthly: { ...expenses.person_monthly, [key]: newVal }
                              })}
                              min={0}
                              className={`w-full border rounded-lg p-1.5 pr-7 font-mono text-xs ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-[11px] text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">{CURRENCY_SYMBOLS[baseCurrency] || baseCurrency}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 2. MENSUALES POR HOGAR */}
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center pb-1.5 gap-1 font-sans">
                      <h4 className="text-xs font-bold uppercase text-sky-700 dark:text-sky-400 tracking-wider text-left">{t.exp_group_household_monthly}</h4>
                      <span className={`text-[11px] font-bold ${themeClasses.textMuted} text-left sm:text-right`}>
                        Subtotal: <span className="font-mono text-slate-950 dark:text-slate-200">{formatCurrency(calculations.sumHouseholdMonthly)}</span>{t.per_month_short}
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-xs">
                      {Object.entries(expenses.household_monthly || {}).map(([key, val]) => (
                        <div key={key} className="flex flex-col gap-1">
                          <label className={`text-[11px] ${themeClasses.textMuted} truncate font-bold font-sans`}>{t[`exp_${key}`] || key}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={val}
                              onChange={newVal => editExpenses({
                                ...expenses,
                                household_monthly: { ...expenses.household_monthly, [key]: newVal }
                              })}
                              min={0}
                              className={`w-full border rounded-lg p-1.5 pr-7 font-mono text-xs ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-[11px] text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">{CURRENCY_SYMBOLS[baseCurrency] || baseCurrency}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 3. ANUALES POR FAMILIA */}
                  <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row justify-between sm:items-center pb-1.5 gap-1 font-sans">
                      <h4 className="text-xs font-bold uppercase text-purple-700 dark:text-purple-400 tracking-wider text-left">{t.exp_group_family_annual}</h4>
                      <span className={`text-[11px] font-bold ${themeClasses.textMuted} text-left sm:text-right`}>
                        Subtotal: <span className="font-mono text-slate-950 dark:text-slate-200">{formatCurrency(calculations.sumFamilyAnnual)}</span> {t.per_year} (<span className="font-mono text-slate-950 dark:text-slate-200">{formatCurrency(calculations.sumFamilyAnnual / 12)}</span>{t.per_month_short})
                      </span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-x-4 gap-y-3 text-xs">
                      {Object.entries(expenses.family_annual || {}).map(([key, val]) => (
                        <div key={key} className="flex flex-col gap-1">
                          <label className={`text-[11px] ${themeClasses.textMuted} truncate font-bold font-sans`}>{t[`exp_${key}`] || key}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={val}
                              onChange={newVal => editExpenses({
                                ...expenses,
                                family_annual: { ...expenses.family_annual, [key]: newVal }
                              })}
                              min={0}
                              className={`w-full border rounded-lg p-1.5 pr-7 font-mono text-xs ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-[11px] text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">{CURRENCY_SYMBOLS[baseCurrency] || baseCurrency}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* RESUMEN TOTAL DE GASTOS */}
                <div className={`border border-sky-500/30 rounded-2xl p-4 sm:p-5 shadow-lg space-y-4 ${isDark ? 'bg-gradient-to-br from-slate-900 via-slate-900 to-sky-950/30' : 'bg-gradient-to-br from-white via-sky-50 to-white'}`}>
                  <div className={`flex flex-col md:flex-row justify-between items-start md:items-center gap-2 border-b ${themeClasses.headerBorder} pb-3`}>
                    <div>
                      <span className="text-xs uppercase font-bold text-sky-700 dark:text-sky-400 tracking-wider font-sans">{t.card_expenses_summary}</span>
                      <h4 className={`text-lg font-extrabold ${themeClasses.textTitle} font-sans`}>
                        {t.exp_total_monthly}: <span className="font-mono text-slate-950 dark:text-white">{formatCurrency(calculations.totalMonthlyExpenses)}</span>{t.per_month_short}
                      </h4>
                    </div>
                    <div className={`text-xs ${themeClasses.textMuted} font-sans`}>
                      {t.exp_total_annual}: <strong className={`${themeClasses.textTitle} font-bold font-mono`}>{formatCurrency(calculations.totalMonthlyExpenses * 12)}</strong> {t.per_year}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.exp_group_person_monthly}</span>
                      <div className="text-base font-bold text-emerald-700 dark:text-emerald-400 font-mono">
                        {formatCurrency(calculations.sumPersonMonthly * validFamilyMembers)}{t.per_month_short}
                      </div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>
                        {formatNumber(validFamilyMembers, 0)} {t.people_short} × {formatCurrency(calculations.sumPersonMonthly)}{t.per_month_short}
                      </span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.exp_group_household_monthly}</span>
                      <div className="text-base font-bold text-sky-700 dark:text-sky-400 font-mono">
                        {formatCurrency(calculations.sumHouseholdMonthly)}{t.per_month_short}
                      </div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>
                        {formatCurrency(calculations.sumHouseholdMonthly * 12)} {t.per_year}
                      </span>
                    </div>

                    <div className={`p-3 rounded-xl border ${themeClasses.cardInner}`}>
                      <span className={`${themeClasses.textMuted} block mb-1 font-bold font-sans`}>{t.exp_group_family_annual}</span>
                      <div className="text-base font-bold text-purple-700 dark:text-purple-400 font-mono">
                        {formatCurrency(calculations.sumFamilyAnnual)} {t.per_year}
                      </div>
                      <span className={`text-[11px] ${themeClasses.textMuted} font-sans`}>
                        {formatCurrency(calculations.sumFamilyAnnual / 12)}{t.per_month_short}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 5: AUDITORÍA */}
            {activeTab === 'ai' && (
              <div className="space-y-5">
                <TabHeader icon="📋" title={t.ai_main_title} description={t.desc_ai} isDark={isDark} />

                {audit.empty ? (
                  <div className={`border p-8 rounded-2xl text-center space-y-2 ${themeClasses.card}`}>
                    <span className="text-3xl">📝</span>
                    <h4 className="font-bold text-sm text-slate-700 dark:text-slate-200">{t.audit_empty_title}</h4>
                    <p className="text-xs text-slate-500 max-w-md mx-auto">{t.audit_empty_desc}</p>
                  </div>
                ) : (
                  <>
                    {/* Dos ejes y la nota combinada derivada de ellos */}
                    <div className={`border p-4 sm:p-6 rounded-2xl ${themeClasses.card} space-y-5`}>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                        {[
                          { key: 'structure', label: t.audit_axis_structure, sub: t.audit_axis_structure_sub, score: audit.structure.score, accent: 'text-purple-700 dark:text-purple-400', bar: 'bg-purple-500' },
                          { key: 'support', label: t.audit_axis_support, sub: t.audit_axis_support_sub, score: audit.support.score, accent: 'text-sky-700 dark:text-sky-400', bar: 'bg-sky-500' }
                        ].map(ax => (
                          <div key={ax.key} className={`p-3.5 rounded-xl border ${themeClasses.cardInner} space-y-2`}>
                            <span className={`text-[11px] font-bold uppercase tracking-wider ${themeClasses.textMuted} font-sans block`}>{ax.label}</span>
                            <div className={`font-mono font-black text-3xl ${ax.accent}`}>{formatNumber(ax.score, 0)}<span className="text-base font-normal opacity-60">/100</span></div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                              <div className={`h-full rounded-full ${ax.bar}`} style={{ width: `${Math.max(0, Math.min(100, ax.score))}%` }}></div>
                            </div>
                            <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{ax.sub}</p>
                          </div>
                        ))}

                        <div className={`p-3.5 rounded-xl border flex flex-col justify-center items-center text-center ${healthScoreStyle.badge}`}>
                          <span className="text-[11px] font-bold uppercase tracking-wider font-sans">{t.ai_score_label}</span>
                          <div className="font-mono font-black text-4xl my-1">{formatNumber(audit.combined, 0)}</div>
                          <span className="text-[11px] font-sans opacity-80">{t.audit_combined_sub}</span>
                        </div>
                      </div>

                      {audit.cap && (
                        <div className="p-3 rounded-xl text-xs font-bold font-sans bg-rose-100 text-rose-950 border border-rose-400 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30">
                          {t.audit_cap_negative_equity.replace('{limit}', String(audit.cap.limit))}
                        </div>
                      )}
                    </div>

                    {/* Una tarjeta por dimensión, generada desde el motor */}
                    <div className="space-y-3">
                      {audit.dimensions.map(d => {
                        const meta = AUDIT_DIMENSION_STYLE[d.id];
                        const na = !d.applicable || d.points === null;
                        const pct = na ? 0 : (d.points / d.max) * 100;
                        return (
                          <div key={d.id} className={`border rounded-xl p-4 space-y-2.5 ${themeClasses.cardInner}`}>
                            <div className="flex justify-between items-start gap-3 font-sans">
                              <div className="flex-1 min-w-0">
                                <strong className={`${meta.accent} font-bold text-sm leading-tight block`}>{t[`audit_dim_${d.id}`]}</strong>
                                <span className={`text-[11px] ${themeClasses.textMuted} uppercase tracking-wider font-bold`}>
                                  {d.axis === 'structure' ? t.audit_axis_structure : t.audit_axis_support}
                                </span>
                              </div>
                              <span className={`px-2.5 py-1 rounded text-xs font-mono font-bold border flex-shrink-0 whitespace-nowrap min-w-[82px] text-center ${na ? `${themeClasses.badgePill}` : meta.badge}`}>
                                {na ? t.audit_na : `${formatNumber(d.points, 1)} / ${d.max}`}
                              </span>
                            </div>

                            {!na && (
                              <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-1.5 overflow-hidden">
                                <div className={`h-full rounded-full ${meta.bar}`} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}></div>
                              </div>
                            )}

                            <p className={`text-xs ${themeClasses.textMuted} font-sans leading-relaxed`}>
                              {na ? t[`audit_na_${d.id}`] : renderDimensionReading(d)}
                            </p>

                            {/* Lo que ya está bien: una nota sin esto solo sabe regañar */}
                            {!na && d.strengths && d.strengths.length > 0 && (
                              <div className="space-y-1">
                                <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800/70 dark:text-emerald-400/70 font-sans">
                                  {t.audit_good_title}
                                </span>
                                <ul className="space-y-1">
                                  {d.strengths.map(st => {
                                    const frase = renderStrength(st);
                                    if (!frase) return null;
                                    return (
                                      <li key={st.id} className="flex items-start gap-1.5 text-[11px] font-sans text-emerald-800 dark:text-emerald-400 leading-snug">
                                        <span aria-hidden="true" className="flex-shrink-0 font-bold">✓</span>
                                        <span className="flex-1">{frase}</span>
                                      </li>
                                    );
                                  })}
                                </ul>
                              </div>
                            )}

                            {/* Libro de penalizaciones: todo lo que descuenta, visible */}
                            {d.id === 'efficiency' && !na && (
                              d.penalties.length === 0 ? (
                                <p className="text-xs text-emerald-700 dark:text-emerald-400 font-semibold font-sans">{t.audit_no_penalties}</p>
                              ) : (
                                <ul className="space-y-1">
                                  {d.penalties.map(pen => (
                                    <li key={pen.id} className="flex justify-between items-start gap-3 text-[11px] font-sans p-2 rounded bg-amber-500/10 text-amber-800 dark:text-amber-400">
                                      <span className="flex-1">
                                        {t[`audit_penalty_${pen.id}`]}
                                        {pen.items.length > 0 && <span className="opacity-80"> — {pen.items.join(', ')}</span>}
                                      </span>
                                      <span className="font-mono font-bold flex-shrink-0">−{formatNumber(pen.cost, 0)} {t.pts}</span>
                                    </li>
                                  ))}
                                </ul>
                              )
                            )}

                            {/* La mejora concreta de esta sección, con sus puntos */}
                            {!na && d.action && (
                              <div className="flex items-start justify-between gap-3 p-2.5 rounded-lg bg-emerald-500/10 border border-emerald-500/25">
                                <div className="flex-1 min-w-0 font-sans">
                                  <span className="block text-[10px] font-bold uppercase tracking-wider text-emerald-800/70 dark:text-emerald-400/70 mb-0.5">
                                    {t.audit_action_label}
                                  </span>
                                  <span className="text-[11.5px] text-emerald-900 dark:text-emerald-300 font-semibold leading-snug">
                                    {renderDimensionAction(d)}
                                  </span>
                                </div>
                                <span className="font-mono font-black text-sm text-emerald-700 dark:text-emerald-400 flex-shrink-0 whitespace-nowrap">
                                  +{formatNumber(d.action.gain, 1)}
                                </span>
                              </div>
                            )}
                            {!na && !d.action && d.points >= d.max - 0.05 && (
                              <p className="text-[11px] text-emerald-700 dark:text-emerald-400 font-semibold font-sans">{t.audit_action_maxed}</p>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Supuestos con los que se ha calculado la nota */}
                    <div className={`border rounded-xl p-4 text-[11px] font-sans ${themeClasses.card} ${themeClasses.textMuted}`}>
                      <strong className={`block mb-1.5 ${themeClasses.textTitle}`}>{t.audit_assumptions_title}</strong>
                      <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono">
                        <span>{t.params_inflation_label.replace(' (%)', '')}: {formatNumber(audit.assumptions.inflationPct)}%</span>
                        <span>{t.audit_assumption_savings_tax}: {formatNumber(audit.assumptions.savingsTaxRatePct)}%</span>
                        <span>{t.audit_assumption_marginal_tax}: {formatNumber(audit.assumptions.marginalIncomeTaxPct)}%</span>
                        <span>{t.audit_assumption_maint}: {formatNumber(audit.assumptions.realEstateMaintenancePct)}%</span>
                        <span>{t.audit_assumption_fire}: {formatNumber(audit.assumptions.fireTargetMultiple, 0)}x</span>
                      </div>
                      <p className="mt-2">{t.audit_assumptions_note}</p>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* PESTAÑA GRÁFICOS */}
            {activeTab === 'charts' && (
              <div className="space-y-6">
                <TabHeader icon="📊" title={t.tab_charts} description={t.desc_charts} isDark={isDark} />

                <div className="grid grid-cols-1 gap-6">
                  {/* 1. Tarta Activos */}
                  <div className={`border p-5 sm:p-6 rounded-2xl space-y-4 ${themeClasses.card}`}>
                    <h4 className={`font-bold text-xs uppercase tracking-wider text-emerald-700 dark:text-emerald-400 font-sans border-b ${themeClasses.headerBorder} pb-2`}>
                      {t.chart_assets_title}
                    </h4>
                  <PieChartSVG
                      total={calculations.totalAssets}
                      formatCurrency={formatCurrency}
                      emptyText={t.col_no_items}
                      data={[
                        ...ASSET_CLASSES.map(k => ({ ...ASSET_CLASS_CHART[k], value: calculations.assetClassTotals[k] }))
                      ]}
                    />
                  </div>

                  {/* 2. Tarta Pasivos */}
                  <div className={`border p-5 sm:p-6 rounded-2xl space-y-4 ${themeClasses.card}`}>
                    <h4 className={`font-bold text-xs uppercase tracking-wider text-rose-700 dark:text-rose-400 font-sans border-b ${themeClasses.headerBorder} pb-2`}>
                      {t.chart_liab_title}
                    </h4>
                  <PieChartSVG
                      total={calculations.totalLiabilities}
                      formatCurrency={formatCurrency}
                      emptyText={t.col_no_items}
                      data={[
                        { label: t.sec_short_term.replace(/^\d+\.\s*/, ''), value: calculations.liabilityCategoryTotals.short_term, color: '#ef4444' },
                        { label: t.sec_personal_loans.replace(/^\d+\.\s*/, ''), value: calculations.liabilityCategoryTotals.personal_loans, color: '#f97316' },
                        { label: t.sec_family_loans.replace(/^\d+\.\s*/, ''), value: calculations.liabilityCategoryTotals.family_loans, color: '#eab308' },
                        { label: t.sec_mortgages.replace(/^\d+\.\s*/, ''), value: calculations.liabilityCategoryTotals.mortgages, color: '#dc2626' }
                      ]}
                    />
                  </div>

                  {/* 3. Dinámica Flujo de Caja Mensual */}
                  <div className={`border p-5 sm:p-6 rounded-2xl space-y-4 ${themeClasses.card}`}>
                    <h4 className={`font-bold text-xs uppercase tracking-wider text-sky-700 dark:text-sky-400 font-sans border-b ${themeClasses.headerBorder} pb-2`}>
                      {t.chart_cashflow_title}
                    </h4>
                    <div className="space-y-3 text-xs pt-1">
                      {[
                        { label: t.wf_gross_cash, value: calculations.monthlyPassiveCashflow, color: calculations.monthlyPassiveCashflow >= 0 ? 'bg-emerald-500' : 'bg-rose-500', isPositive: calculations.monthlyPassiveCashflow >= 0 },
                        { label: t.wf_debt_service, value: calculations.monthlyDebtPayments, color: 'bg-rose-500', isPositive: false },
                        ...(calculations.monthlyWealthTax > 0 ? [{ label: t.wf_wealth_tax, value: calculations.monthlyWealthTax, color: 'bg-fuchsia-500', isPositive: false }] : []),
                        { label: t.wf_living_costs, value: calculations.totalMonthlyExpenses, color: 'bg-amber-500', isPositive: false },
                        { label: t.wf_final_net_cash, value: calculations.netMonthlyCashflow, color: calculations.netMonthlyCashflow >= 0 ? 'bg-emerald-600' : 'bg-rose-600', isPositive: calculations.netMonthlyCashflow >= 0 }
                      ].map((b, i) => {
                        const maxVal = Math.max(calculations.monthlyPassiveCashflow, calculations.totalMonthlyExpenses + calculations.monthlyDebtPayments + calculations.monthlyWealthTax, 1);
                        const widthPct = Math.min(100, Math.max(8, (Math.abs(b.value) / maxVal) * 100));
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex justify-between items-center text-[11px] font-sans">
                              <span className="truncate font-medium">{b.label}</span>
                              <span className={`font-mono font-bold ${b.isPositive ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                                {b.isPositive ? '+' : '-'}{formatCurrency(Math.abs(b.value))}{t.per_month_short}
                              </span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                              <div className={`h-full rounded-full ${b.color}`} style={{ width: `${widthPct}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* 4. Distribución Gastos Familiares */}
                  <div className={`border p-5 sm:p-6 rounded-2xl space-y-4 ${themeClasses.card}`}>
                    <h4 className={`font-bold text-xs uppercase tracking-wider text-purple-700 dark:text-purple-400 font-sans border-b ${themeClasses.headerBorder} pb-2`}>
                      {t.chart_expenses_title}
                    </h4>
                    <div className="space-y-3 text-xs pt-1">
                      {[
                        { label: `${t.exp_group_person_monthly} (${validFamilyMembers} pers.)`, value: calculations.sumPersonMonthly * validFamilyMembers, color: 'bg-emerald-500' },
                        { label: t.exp_group_household_monthly, value: calculations.sumHouseholdMonthly, color: 'bg-sky-500' },
                        { label: `${t.exp_group_family_annual_month}`, value: calculations.sumFamilyAnnual / 12, color: 'bg-purple-500' }
                      ].map((g, i) => {
                        const pct = calculations.totalMonthlyExpenses > 0 ? (g.value / calculations.totalMonthlyExpenses) * 100 : 0;
                        return (
                          <div key={i} className="space-y-1">
                            <div className="flex justify-between items-center text-[11px] font-sans">
                              <span className="truncate font-medium">{g.label}</span>
                              <span className="font-mono font-bold">{formatCurrency(g.value)}{t.per_month_short} <span className="font-sans font-normal text-slate-500">({pct.toFixed(1)}%)</span></span>
                            </div>
                            <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2.5 overflow-hidden">
                              <div className={`h-full rounded-full ${g.color}`} style={{ width: `${Math.max(4, pct)}%` }}></div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* PESTAÑA 7: PARÁMETROS, FISCALIDAD Y GUARDAR/CARGAR DATOS */}
            {activeTab === 'params' && (
              <div className="space-y-6">
                <TabHeader icon="⚙️" title={t.params_title} description={t.params_subtitle} isDark={isDark} />
                
                {/* Caja 1: Supuestos Macroeconómicos y Fiscales */}
                <div className={`border p-4 sm:p-6 rounded-2xl space-y-6 ${themeClasses.card}`}>
                  {/* 1. Supuestos Macroeconómicos */}
                  <div className="space-y-4">
                    <h4 className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider font-sans">{t.params_macro_heading}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_inflation_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_inflation_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.inflationPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, inflationPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_re_appreciation_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_re_appreciation_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.realEstateAppreciationPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, realEstateAppreciationPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_stock_growth_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_stock_growth_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.stockGrowthPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, stockGrowthPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_ref_div_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_ref_div_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.refDividendYieldPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, refDividendYieldPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_bond_yield_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_bond_yield_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.bondYieldPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, bondYieldPct: v })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_tips_real_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_tips_real_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.tipsRealYieldPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, tipsRealYieldPct: v })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_gold_real_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_gold_real_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.goldRealReturnPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, goldRealReturnPct: v })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_re_maint_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_re_maint_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.realEstateMaintenancePct}
                            decimals={2}
                                onChange={v => setMacroParams({ ...macroParams, realEstateMaintenancePct: v })}
                                className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_fire_multiple_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_fire_multiple_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.fireTargetMultiple}
                            decimals={0}
                            min={1}
                            onChange={v => setMacroParams({ ...macroParams, fireTargetMultiple: Math.max(1, Math.abs(v)) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">x</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* 2. Fiscalidad y Costes Inmobiliarios */}
                  <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h4 className="text-xs font-bold uppercase text-sky-700 dark:text-sky-400 tracking-wider font-sans">{t.params_tax_heading}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_rental_costs_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_rental_costs_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.rentalOperatingCostsPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, rentalOperatingCostsPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_marginal_tax_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_marginal_tax_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.marginalIncomeTaxPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, marginalIncomeTaxPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_rental_deduction_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_rental_deduction_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.rentalPrimaryHomeDeductionPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, rentalPrimaryHomeDeductionPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>

                      {/* La escala del ahorro es ley, no un supuesto que se elija: se
                          muestra en lugar de un campo editable, con el tipo medio que
                          sale de aplicarla a la renta que genera este balance. */}
                      <div className="flex flex-col justify-between sm:col-span-2">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_savings_tax_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_savings_tax_desc}</p>
                        </div>
                        <div className={`p-2.5 rounded-lg border ${themeClasses.cardInner}`}>
                          <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px]">
                            {SAVINGS_TAX_BRACKETS.map((b, i) => (
                              <span key={i} className={themeClasses.textMuted}>
                                {b.upTo === Infinity
                                  ? t.params_savings_bracket_rest
                                  : t.params_savings_bracket_upto.replace('{limit}', formatCurrency(b.upTo))}
                                :{' '}
                                <strong className={themeClasses.textTitle}>{formatNumber(b.ratePct, 0)}%</strong>
                              </span>
                            ))}
                          </div>
                          <p className={`text-[11px] ${themeClasses.textMuted} mt-2 font-sans leading-snug`}>
                            {calculations.grossSavingsIncome > 0
                              ? t.params_savings_tax_current
                                  .replaceAll('{income}', formatCurrency(calculations.grossSavingsIncome))
                                  .replaceAll('{rate}', formatNumber(calculations.effectiveSavingsRatePct, 2))
                                  .replaceAll('{tax}', formatCurrency(calculations.savingsTaxDue))
                              : t.params_savings_tax_none}
                          </p>
                        </div>
                      </div>
                    </div>


                  {/* 3. Supuestos de liquidación */}
                  <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h4 className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider font-sans">{t.params_liq_heading}</h4>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_pension_tax_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_pension_tax_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.pensionWithdrawalTaxPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, pensionWithdrawalTaxPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_property_sell_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_property_sell_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.propertySellingCostsPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, propertySellingCostsPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_tangibles_haircut_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_tangibles_haircut_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.tangiblesHaircutPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, tangiblesHaircutPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_early_fee_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_early_fee_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.earlyRepaymentFeePct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, earlyRepaymentFeePct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_unrealized_gain_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_unrealized_gain_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.assumedUnrealizedGainPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, assumedUnrealizedGainPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                    </div>
                  </div>


                  {/* 4. Impuesto sobre el patrimonio */}
                  <div className="space-y-4 pt-2 border-t border-slate-200 dark:border-slate-800">
                    <h4 className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider font-sans">{t.params_wealth_heading}</h4>
                    <div className={`p-2.5 rounded-lg border text-[11px] leading-snug font-sans ${themeClasses.cardInner} ${themeClasses.textMuted}`}>
                      {t.params_wealth_asof.replace('{date}', WEALTH_TAX_AS_OF)}
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4 text-xs">
                      <div className="flex flex-col justify-between sm:col-span-2">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_wealth_region_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_wealth_region_desc}</p>
                        </div>
                        <select
                          value={macroParams.wealthTaxRegion || 'estatal'}
                          onChange={e => setMacroParams({ ...macroParams, wealthTaxRegion: e.target.value, wealthTaxExemption: null, wealthTaxBonificationPct: null })}
                          className={`w-full border rounded-lg p-2 text-xs font-sans ${themeClasses.input}`}
                        >
                          {Object.entries(WEALTH_TAX_REGIONS).map(([k, v]) => (
                            <option key={k} value={k}>{lang === 'es' ? v.name_es : v.name_en}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex flex-col justify-between sm:col-span-2">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_wealth_payers_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_wealth_payers_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.wealthTaxPayers ?? 1}
                            decimals={0}
                            onChange={v => setMacroParams({ ...macroParams, wealthTaxPayers: Math.max(1, Math.round(Math.abs(v) || 1)) })}
                            className={`w-full border rounded-lg p-2 font-mono text-xs ${themeClasses.input}`}
                          />
                        </div>
                      </div>
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_wealth_exemption_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_wealth_exemption_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.wealthTaxExemption ?? regimenPatrimonio.exemption}
                            decimals={0}
                            onChange={v => setMacroParams({ ...macroParams, wealthTaxExemption: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">€</span>
                        </div>
                      </div>
                      <div className="flex flex-col justify-between">
                        <div>
                          <label className={`block mb-0.5 font-bold leading-tight ${themeClasses.textTitle} font-sans`}>{t.params_wealth_bonif_label}</label>
                          <p className={`text-[11px] ${themeClasses.textMuted} mb-2 font-sans`}>{t.params_wealth_bonif_desc}</p>
                        </div>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={macroParams.wealthTaxBonificationPct ?? regimenPatrimonio.bonificationPct}
                            decimals={2}
                            onChange={v => setMacroParams({ ...macroParams, wealthTaxBonificationPct: Math.abs(v) })}
                            className={`w-full border rounded-lg p-2 pr-7 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                    </div>
                    <div className={`p-2.5 rounded-lg border ${themeClasses.cardInner}`}>
                      <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-snug`}>
                        {calculations.wealthTax.annual > 0
                          ? t.params_wealth_current
                              .replaceAll('{annual}', formatCurrency(calculations.wealthTax.annual))
                              .replaceAll('{monthly}', formatCurrency(calculations.monthlyWealthTax))
                          : t.params_wealth_none}
                        {calculations.wealthTax.annual > 0 && calculations.wealthTax.taxpayers > 1 && ' ' +
                          t.params_wealth_split
                            .replaceAll('{payers}', String(calculations.wealthTax.taxpayers))
                            .replaceAll('{each}', formatCurrency(calculations.wealthTax.annualPerTaxpayer))}
                        {calculations.wealthTax.solidarityApplies && ' ' + t.params_wealth_solidarity}
                      </p>
                    </div>
                  </div>

                    <div className={`p-3.5 rounded-xl border text-xs leading-relaxed ${themeClasses.cardInner} ${themeClasses.textMuted} mt-4 font-sans`}>
                      {t.params_rates_note}
                    </div>

             {/* --- SUPUESTOS --- */}
             <div className={`border p-4 sm:p-6 rounded-2xl space-y-3 ${themeClasses.card}`}>
               <div>
                 <h4 className={`text-sm font-black ${themeClasses.textTitle} font-sans`}>{t.assumptions_title}</h4>
                 <p className={`text-[11px] ${themeClasses.textMuted} mt-1 font-sans leading-relaxed`}>{t.assumptions_subtitle}</p>
               </div>
               <div className="space-y-1.5">
                 {assumptions.map(sec => {
                   const abierta = expandedAssumption === sec.id;
                   return (
                     <div key={sec.id} className={`border rounded-xl overflow-hidden ${themeClasses.cardInner}`}>
                       <button
                         type="button"
                         onClick={() => setExpandedAssumption(abierta ? null : sec.id)}
                         aria-expanded={abierta}
                         className="w-full p-2.5 text-left font-bold flex justify-between items-center gap-2 text-xs font-sans"
                       >
                         <span className={themeClasses.textTitle}>{lang === 'es' ? sec.title_es : sec.title_en}</span>
                         <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold flex-shrink-0 text-sm">{abierta ? '▲' : '▼'}</span>
                       </button>
                       {abierta && (
                         /* `whitespace-pre-line` porque estos textos vienen en párrafos y aquí
                            se pintaban de corrido: media página sin un solo punto y aparte,
                            que es donde se pierde lo que de verdad hay que leer. */
                         <div className={`p-2.5 pt-0 text-[11px] leading-relaxed border-t border-slate-200 dark:border-slate-800/60 whitespace-pre-line ${themeClasses.textMuted} font-sans`}>
                           {lang === 'es' ? sec.body_es : sec.body_en}
                         </div>
                       )}
                     </div>
                   );
                 })}
               </div>
             </div>

             <div className="pt-2 flex justify-start">
                <button
                  type="button"
                  onClick={handleResetMacroParams}
                  className={`text-xs px-3 py-2 rounded-lg border font-bold transition ${themeClasses.btnSecondary} font-sans`}
                >
                  {t.btn_reset_params}
                </button>
              </div>
                  </div>
                </div>

                {/* Caja 2: Guardar y Cargar Datos (Backup / Restore) */}
                <div className={`border p-4 sm:p-6 rounded-2xl space-y-4 ${themeClasses.card}`}>
                  <div className="border-b pb-3 border-slate-200 dark:border-slate-800">
                    <h4 className="text-xs font-bold uppercase text-emerald-700 dark:text-emerald-400 tracking-wider font-sans">
                      {t.data_mgmt_title}
                    </h4>
                    <p className={`text-xs ${themeClasses.textMuted} mt-1 leading-relaxed font-sans`}>
                      {t.data_mgmt_desc}
                    </p>
                  </div>

                  <div className={`p-3.5 rounded-xl border text-xs leading-relaxed font-sans ${
                    isOfflineRates
                      ? 'bg-amber-100 text-amber-950 border-amber-400 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30'
                      : `${themeClasses.cardInner} ${themeClasses.textMuted}`
                  }`}>
                    <strong className="font-bold">{t.market_data_heading}:</strong>{' '}
                    {isOfflineRates
                      ? t.market_data_offline
                      : marketDataMeta && marketDataMeta.generatedAt
                        ? `${t.market_data_live} ${new Date(marketDataMeta.generatedAt).toLocaleDateString(numberLocale, { day: 'numeric', month: 'long', year: 'numeric' })}.`
                        : t.market_data_unknown}
                    {!isOfflineRates && marketDataMeta && marketDataMeta.staleRates && marketDataMeta.staleRates.length > 0 && (
                      <span className="block mt-1 text-amber-700 dark:text-amber-400 font-semibold">
                        {t.market_data_stale} {marketDataMeta.staleRates.join(', ')}.
                      </span>
                    )}
                  </div>

                  {dataFeedbackMsg && (
                    <div className={`p-3 rounded-xl text-xs font-bold font-sans ${
                      dataFeedbackMsg.type === 'success'
                        ? 'bg-emerald-100 text-emerald-950 border border-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-300 dark:border-emerald-500/30'
                        : 'bg-rose-100 text-rose-950 border border-rose-400 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30'
                    }`}>
                      {dataFeedbackMsg.text}
                    </div>
                  )}
                 <div className="flex flex-col sm:flex-row gap-3 pt-2">
                    {/* Botón Exportar PDF */}
                    <button
                      onClick={handleExportPDF}
                      className="flex-1 bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs sm:text-sm py-3 px-4 rounded-xl transition shadow-md flex items-center justify-center gap-2 font-sans"
                    >
                    <span>{t.btn_export_pdf}</span>
                    </button>

                    {/* Botón Guardar Datos */}
                    <button
                      onClick={handleExportData}
                      className="flex-1 bg-brand-emerald hover:bg-emerald-400 text-slate-950 font-bold text-xs sm:text-sm py-3 px-4 rounded-xl transition shadow-md flex items-center justify-center gap-2 font-sans"
                    >
                      <span>{t.btn_export_data}</span>
                    </button>

                    {/* Botón Cargar Datos */}
                    <button
                      onClick={() => fileInputRef.current && fileInputRef.current.click()}
                      className={`flex-1 font-bold text-xs sm:text-sm py-3 px-4 rounded-xl border transition shadow-sm flex items-center justify-center gap-2 font-sans ${themeClasses.btnSecondary}`}
                    >
                      <span>{t.btn_import_data}</span>
                    </button>

                  </div>

                  {/* Volver al balance de ejemplo. Debajo y en rojo, como su
                      gemelo ♻️ de la cabecera y el de Parámetros en /retiro:
                      borra todo lo del usuario y no tiene vuelta atrás. */}
                  <div className="pt-1">
                    <button
                      type="button"
                      onClick={handleRestoreSampleData}
                      className="h-8 px-3 bg-rose-500/10 border border-rose-500/40 text-rose-700 dark:text-rose-400 hover:bg-rose-500/20 text-xs font-semibold rounded-lg transition flex items-center gap-1.5 font-sans"
                    >
                      <span>♻️</span>
                      <span>{t.btn_restore_sample}</span>
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* PANEL LATERAL: CASCADA & HITOS FIRE */}
          <div className="space-y-6 font-sans min-w-0 w-full">
            {/* 1. Flujo de Caja Mensual */}
            <div className={`border p-4 sm:p-5 rounded-xl space-y-4 ${themeClasses.card}`}>
              <h3 className={`font-bold text-sm border-b ${themeClasses.headerBorder} pb-3 ${themeClasses.textTitle}`}>
                {t.waterfall_title}
              </h3>

              {/* Titular: qué parte de la vida pagan los activos. */}
              {(() => {
                const cov = calculations.coverage;
                if (cov.pct === null) {
                  return (
                    <div className={`p-3.5 rounded-xl border ${themeClasses.cardInner} ${themeClasses.textMuted} text-xs font-sans`}>
                      {t.coverage_undefined}
                    </div>
                  );
                }
                const full = cov.ratio >= 1;
                const tone = full ? 'emerald' : cov.pct >= 50 ? 'sky' : 'amber';
                const toneText = { emerald: 'text-emerald-700 dark:text-emerald-400', sky: 'text-sky-700 dark:text-sky-400', amber: 'text-amber-700 dark:text-amber-400' }[tone];
                const toneBar = { emerald: 'bg-emerald-500', sky: 'bg-sky-500', amber: 'bg-amber-500' }[tone];
                return (
                  <div className={`p-3.5 rounded-xl border ${themeClasses.cardInner} space-y-2`}>
                    <div className="flex items-baseline justify-between gap-2 font-sans">
                      <Tooltip text={
                        // replaceAll: varios marcadores aparecen dos veces y
                        // `replace` con texto plano solo cambia el primero.
                        t.tt_coverage
                          .replaceAll('{passive}', formatCurrency(cov.passive))
                          .replaceAll('{expenses}', formatCurrency(calculations.totalMonthlyExpenses))
                          // Cuotas más impuesto sobre el patrimonio: es lo que suma
                          // {burn}. Con las cuotas solas, las cifras del texto no
                          // cuadraban en cuanto había impuesto.
                          .replaceAll('{debt}', formatCurrency(calculations.monthlyDebtPayments + calculations.monthlyWealthTax))
                          .replaceAll('{burn}', formatCurrency(cov.burn))
                          .replaceAll('{pct}', formatNumber(cov.pct, 1))
                      }>
                        <span className={`text-[11px] font-bold uppercase tracking-wider ${themeClasses.textMuted}`}>{t.coverage_title} ⓘ</span>
                      </Tooltip>
                      <Tooltip text={
                        t.tt_coverage_formula
                          .replaceAll('{passive}', formatCurrency(cov.passive))
                          .replaceAll('{burn}', formatCurrency(cov.burn))
                          .replaceAll('{pct}', formatNumber(cov.pct, 1))
                      }>
                        <span className={`font-mono font-black text-2xl ${toneText}`}>{formatNumber(cov.pct, 1)}%</span>
                      </Tooltip>
                    </div>
                    <div className="w-full bg-slate-200 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div className={`h-full rounded-full ${toneBar}`} style={{ width: `${Math.min(100, cov.pct)}%` }}></div>
                    </div>
                    <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>
                      {full ? t.coverage_full : t.coverage_gap.replace('{gap}', formatCurrency(cov.gap))}
                    </p>
                    {cov.usePct > 0.05 && (
                      <p className="text-[11px] text-sky-700 dark:text-sky-400 font-sans leading-tight font-semibold">
                        {t.coverage_use.replace('{pct}', formatNumber(cov.usePct, 1))}
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className={`space-y-2 text-xs p-3.5 rounded-xl border ${isDark ? 'bg-slate-950/60 border-slate-800/80 text-slate-200' : 'bg-slate-50 border-slate-200 text-slate-950 font-bold'}`}>
                <span className={`text-[10px] uppercase font-extrabold block mb-1 ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{t.wf_breakdown_title}</span>
                <div className="flex justify-between items-center font-sans">
                  <span>{t.wf_rent_incomes}</span>
                  <span className={`font-mono font-bold ${calculations.rentalCashflowMonthly >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {calculations.rentalCashflowMonthly >= 0 ? '+' : ''}{formatCurrency(calculations.rentalCashflowMonthly)}{t.per_month_short}
                  </span>
                </div>
                <div className="flex justify-between items-center font-sans">
                  <span>{t.wf_dividend_incomes}</span>
                  <span className={`font-mono font-bold ${calculations.dividendCashflowMonthly >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {calculations.dividendCashflowMonthly >= 0 ? '+' : ''}{formatCurrency(calculations.dividendCashflowMonthly)}{t.per_month_short}
                  </span>
                </div>
              <div className="flex justify-between items-center font-sans">
                  <span>{t.wf_interest_incomes}</span>
                  <span className={`font-mono font-bold ${calculations.interestCashflowMonthly >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {calculations.interestCashflowMonthly >= 0 ? '+' : ''}{formatCurrency(calculations.interestCashflowMonthly)}{t.per_month_short}
                  </span>
                </div>
                {calculations.tangiblesCashflowMonthly !== 0 && (
                  <div className="flex justify-between items-center font-sans">
                    <span>• {t.type_tangibles}</span>
                    <span className={`font-mono font-bold ${calculations.tangiblesCashflowMonthly >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                      {calculations.tangiblesCashflowMonthly >= 0 ? '+' : ''}{formatCurrency(calculations.tangiblesCashflowMonthly)}{t.per_month_short}
                    </span>
                  </div>
                )}
              </div>

              <div className="space-y-3 text-xs pt-1">
                <div className={`flex justify-between items-center ${themeClasses.textTitle}`}>
                  <Tooltip text={t.tt_cash_return}>
                    <span className="font-bold font-sans">{t.wf_gross_cash} ⓘ</span>
                  </Tooltip>
                  <span className={`font-mono font-black text-sm ${calculations.monthlyPassiveCashflow >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {calculations.monthlyPassiveCashflow >= 0 ? '+' : ''}{formatCurrency(calculations.monthlyPassiveCashflow)}
                  </span>
                </div>

          <div className={`flex justify-between items-center ${themeClasses.textTitle}`}>
                  <span className="font-sans">{t.wf_debt_service}</span>
                  <span className={`font-mono font-bold ${calculations.monthlyDebtPayments > 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    -{formatCurrency(calculations.monthlyDebtPayments)}
                  </span>
                </div>

                {calculations.monthlyWealthTax > 0 && (
                  <div className={`flex justify-between items-center ${themeClasses.textTitle}`}>
                    <Tooltip text={t.tt_wealth_tax_row}>
                      <span className="font-sans">{t.wf_wealth_tax} ⓘ</span>
                    </Tooltip>
                    <span className="font-mono font-bold text-rose-700 dark:text-rose-400">
                      -{formatCurrency(calculations.monthlyWealthTax)}
                    </span>
                  </div>
                )}

                <div className="border-t border-slate-200 dark:border-slate-800 my-1"></div>

                <div className={`flex justify-between items-center font-bold ${themeClasses.textTitle}`}>
                  <span className="font-sans">{t.wf_net_balance_cash}</span>
                  <span className={`font-mono ${calculations.assetCashflowSurplus >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                    {calculations.assetCashflowSurplus >= 0 ? '+' : ''}{formatCurrency(calculations.assetCashflowSurplus)}{t.per_month_short}
                  </span>
                </div>

                <div className={`flex justify-between items-center ${themeClasses.textTitle}`}>
                  <span className="font-sans">{t.wf_living_costs}</span>
                  <span className={`font-mono font-semibold ${-calculations.totalMonthlyExpenses < 0 ? 'text-rose-700 dark:text-rose-400' : 'text-emerald-700 dark:text-emerald-400'}`}>
                    -{formatCurrency(calculations.totalMonthlyExpenses)}
                  </span>
                </div>

                <div className="border-t border-slate-200 dark:border-slate-800 pt-2 space-y-1">
                  <div className="flex justify-between items-center font-black text-sm">
                    <span className={`${themeClasses.textTitle} font-sans`}>{t.wf_final_net_cash}</span>
                    <span className={`font-mono ${calculations.netMonthlyCashflow >= 0 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}`}>
                      {calculations.netMonthlyCashflow >= 0 ? '+' : ''}{formatCurrency(calculations.netMonthlyCashflow)}{t.per_month_short}
                    </span>
                  </div>
                  <p className={`text-[11px] ${calculations.netMonthlyCashflow >= 0 ? 'text-emerald-700 dark:text-emerald-400 font-semibold' : themeClasses.textMuted} font-sans font-medium`}>
                    {calculations.netMonthlyCashflow >= 0 ? t.wf_final_net_ok : t.wf_final_net_ko}
                  </p>
                </div>
              </div>
            </div>

            {/* 2. SECCIÓN: FINANCIAL FREEDOM MILESTONES */}
            <div className={`border p-4 sm:p-5 rounded-xl space-y-3.5 ${themeClasses.card}`}>
              <div className="border-b pb-3 flex justify-between items-center">
                <h3 className={`font-bold text-sm ${themeClasses.textTitle}`}>
                  <Tooltip text={t.tt_fire}>
                    <span>{t.milestones_card_title} ⓘ</span>
                  </Tooltip>
                </h3>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 font-bold">
                  {calculations.statusLevels.filter(s => s === 'green').length}/7 {t.levels_suffix}
                </span>
              </div>

        {/* Level 0: Liquidity Buffer */}
        {(() => {
          const meta = calculations.milestoneDetails[0] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l0_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                  {calculations.runwayNetMonths === Infinity ? t.buffer_opt : `${formatNumber(calculations.runwayNetMonths, 1)} / 6 ${t.kpi_months}`}
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l0_desc}</p>
            </div>
          );
        })()}
        
        {/* Level 1: Foundation */}
        {(() => {
          const meta = calculations.milestoneDetails[1] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1.5 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l1_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                  {formatCurrency(calculations.nonPrimaryNetWorth)}
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l1_desc}</p>
            {meta.isBlocked && (
                <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-800 dark:text-rose-300 font-bold flex items-center gap-1">
                  <span>
                    {t.m_blocked_by} {meta.blockedBy}
                    {meta.meetsOwnCriteria && <> · {t.m_blocked_but_met}</>}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        
{/* Level 2: Healthy Growth */}
        {(() => {
          const meta = calculations.milestoneDetails[2] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1.5 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l2_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                  {formatNumber(calculations.roaFinancial)}% vs {formatNumber(calculations.expectedInflationRate + 1.50)}%
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l2_desc} ({formatNumber(calculations.expectedInflationRate)}%).</p>
              {meta.isBlocked && (
                <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-800 dark:text-rose-300 font-bold flex items-center gap-1">
                  <span>
                    {t.m_blocked_by} {meta.blockedBy}
                    {meta.meetsOwnCriteria && <> · {t.m_blocked_but_met}</>}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        
        {/* Level 3: Asset Self-Sufficiency */}
        {(() => {
          const meta = calculations.milestoneDetails[3] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1.5 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l3_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                  {calculations.assetCashflowSurplus >= 0 ? `+${formatCurrency(calculations.assetCashflowSurplus)}${t.per_month_short}` : `${formatCurrency(calculations.assetCashflowSurplus)}${t.per_month_short}`}
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l3_desc}</p>
              {meta.isBlocked && (
                <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-800 dark:text-rose-300 font-bold flex items-center gap-1">
                  <span>
                    {t.m_blocked_by} {meta.blockedBy}
                    {meta.meetsOwnCriteria && <> · {t.m_blocked_but_met}</>}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        
        {/* Level 4: Basic Freedom */}
        {(() => {
          const meta = calculations.milestoneDetails[4] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1.5 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l4_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                  {formatCurrency(calculations.assetCashflowSurplus)} / {formatCurrency(calculations.leanMonthlyExpenses)}{t.per_month_short}
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l4_desc}</p>
              {meta.isBlocked && (
                <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-800 dark:text-rose-300 font-bold flex items-center gap-1">
                  <span>
                    {t.m_blocked_by} {meta.blockedBy}
                    {meta.meetsOwnCriteria && <> · {t.m_blocked_but_met}</>}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        
        {/* Level 5: Financial Freedom */}
        {(() => {
          const meta = calculations.milestoneDetails[5] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1.5 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l5_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                  {formatCurrency(calculations.netMonthlyCashflow)}{t.per_month_short}
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l5_desc}</p>
              {meta.isBlocked && (
                <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-800 dark:text-rose-300 font-bold flex items-center gap-1">
                  <span>
                    {t.m_blocked_by} {meta.blockedBy}
                    {meta.meetsOwnCriteria && <> · {t.m_blocked_but_met}</>}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
        
        {/* Level 6: Abundance */}
        {(() => {
          const meta = calculations.milestoneDetails[6] || {};
          const style = getMilestoneStyle(meta.status || 'red');
          return (
            <div className={`p-3.5 rounded-xl border space-y-1.5 ${style.container}`}>
              <div className="flex justify-between items-center font-sans">
                <span className={`font-bold text-xs ${style.titleText}`}><span aria-hidden="true" className="mr-1">{style.mark}</span><span className="sr-only">{style.markLabel}: </span>{t.m_l6_title}</span>
                <span className={`font-mono font-bold text-xs ${style.metricText}`}>
                    {formatNumber(calculations.yearsOfExpensesCovered, 1)} / {formatNumber(calculations.fireTargetMultiple, 0)} {t.kpi_years}
                </span>
              </div>
              <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-tight`}>{t.m_l6_desc}</p>
              {meta.isBlocked && (
                <div className="pt-1 border-t border-rose-500/20 text-[10px] text-rose-800 dark:text-rose-300 font-bold flex items-center gap-1">
                  <span>
                    {t.m_blocked_by} {meta.blockedBy}
                    {meta.meetsOwnCriteria && <> · {t.m_blocked_but_met}</>}
                  </span>
                </div>
              )}
            </div>
          );
        })()}
              {/* Balance es la foto de hoy; la pregunta de cuándo se llega la
                  contesta Retiro, que lee el mismo fichero. */}
              <p className={`pt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] ${themeClasses.textMuted} font-sans no-print`}>
                {t.fire_retiro_cta}{' '}
                <a href={TOOL_URLS.retiro} target="_blank" rel="noopener" className="font-bold underline text-brand-accent hover:opacity-80">pacolucena.com/retiro</a>
              </p>
            </div>

            {/* Combined Legal Disclaimer & Credits */}
            <div className={`p-3.5 rounded-xl border text-[11px] leading-relaxed ${themeClasses.card} ${themeClasses.textMuted} font-sans shadow-sm space-y-2`}>
              <p>
                ⚖️ <strong className={themeClasses.textTitle}>{t.disclaimer_title}</strong>: {t.disclaimer_body}{' '}
                <em className="text-[10px]">{t.affiliate_disclosure}</em>
              </p>
              <p className="pt-1 border-t border-slate-200 dark:border-slate-800">
                {t.created_by_text} <a href="https://pacolucena.com" target="_blank" rel="noreferrer" className="font-bold underline text-slate-900 dark:text-slate-100 hover:text-brand-accent">pacolucena.com</a>
                {' · '}<ContactEmailButton label={t.contact_label} copiedLabel={t.contact_copied} />
              </p>
            </div>
            {/* Ayuda & Share Links */}
            <div className="flex justify-center items-center gap-3 pt-1 text-xs">
              <button
                onClick={() => setShowOnboardingModal(true)}
                className="inline-flex items-center gap-1 font-semibold text-brand-textMuted hover:text-brand-accent transition underline underline-offset-4"
              >
                <span>💡</span>
                <span>{t.btn_help}</span>
              </button>
              <span className="text-slate-400 dark:text-slate-600">•</span>
             <button
                onClick={() => setShowShareModal(true)}
                className="inline-flex items-center gap-1 font-semibold text-brand-textMuted hover:text-brand-accent transition underline underline-offset-4"
              >
                <span>🔗</span>
                <span>{t.share_balance_cta}</span>
              </button>
            </div>
          </div>
        </main>
        
        {/* ========================================================= */}
        {/* DEDICATED FULL MULTI-TAB PRINT REPORT */}
        {/* ========================================================= */}
        <div className="print-only-report font-sans text-slate-900">
          
          {(() => {
            const passedLevels = calculations.statusLevels.filter(s => s === 'green').length;
            const ltvColorClass = calculations.ltv < 40 ? 'pdf-green' : calculations.ltv <= 60 ? 'pdf-amber' : 'pdf-rose';
            const currentSiteUrl = typeof window !== 'undefined' ? window.location.href.split('#')[0].split('?')[0] : 'https://patrimonio-os.com';

            // Format date: DD/MMM/YYYY in Spanish, MMM/DD/YYYY in English
            const now = new Date();
            const day = String(now.getDate()).padStart(2, '0');
            const monthShort = now.toLocaleString(lang === 'es' ? 'es-ES' : 'en-US', { month: 'short' }).replace('.', '');
            const year = now.getFullYear();
            const formattedDate = lang === 'es' ? `${day}/${monthShort}/${year}` : `${monthShort}/${day}/${year}`;

            // Health Score color coding based on web app rules
            let healthScoreClass = 'bg-emerald-100 text-emerald-900 border-emerald-300';
            if (audit.combined < 40) {
              healthScoreClass = 'bg-rose-100 text-rose-900 border-rose-300';
            } else if (audit.combined <= 75) {
              healthScoreClass = 'bg-amber-100 text-amber-900 border-amber-300';
            }

            // Milestone definitions
            const milestoneList = [
              { level: 0, title: t.m_l0_title, desc: t.m_l0_desc },
              { level: 1, title: t.m_l1_title, desc: t.m_l1_desc },
              { level: 2, title: t.m_l2_title, desc: t.m_l2_desc },
              { level: 3, title: t.m_l3_title, desc: t.m_l3_desc },
              { level: 4, title: t.m_l4_title, desc: t.m_l4_desc },
              { level: 5, title: t.m_l5_title, desc: t.m_l5_desc },
              { level: 6, title: t.m_l6_title, desc: t.m_l6_desc }
            ];

            const isCurrentPassed = passedLevels > 0;
            const targetStepIdx = passedLevels >= 7 ? 7 : (passedLevels === 0 ? 0 : passedLevels);

            const currentStepInfo = milestoneList[passedLevels === 0 ? 0 : passedLevels - 1];
            const targetStepInfo = passedLevels >= 7 ? null : milestoneList[passedLevels === 0 ? 0 : passedLevels];
      
            return (
              <>
            {/* Header limpio con único borde inferior. El título va en h2: el informe
                está siempre en la página, oculto hasta imprimir, y el único h1 tiene que
                ser el de la herramienta. */}
                <div className="flex justify-between items-center border-0 border-b-2 border-slate-900 pb-2 mb-2.5">
                  <div>
                    <h2 className="text-lg font-black tracking-tight flex items-center gap-1.5 border-0">
                      <span className="bg-emerald-600 text-white px-1.5 py-0.5 rounded text-[11px] font-black border-0">FIRE</span>
                      {t.app_title} — {t.report_title}
                    </h2>
                    <div className="flex items-center gap-2 mt-0.5 border-0">
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-900 border border-emerald-300 font-sans">
                        🔥 {t.report_step.replace('{n}', String(passedLevels))}
                      </span>
                      <span className="text-[9.5px] pdf-muted border-0">
                        {t.report_generated_on}: {formattedDate} | {t.base_currency_label}: {baseCurrency}
                      </span>
                    </div>
                  </div>
                  <div className="text-right border-0">
                    <div className="text-base font-black text-slate-900 font-mono border-0">{formatCurrency(calculations.netWorth)}</div>
                    <div className="text-[9.5px] font-bold border-0">
                      <span className="pdf-green">ROE {formatNumber(calculations.roe)}%</span>
                      <span className="pdf-muted"> | </span>
                      <span className={ltvColorClass}>LTV {formatNumber(calculations.ltv, 1)}% ({calculations.ltv < 40 ? t.ltv_healthy_short : calculations.ltv <= 60 ? t.ltv_moderate_short : t.ltv_high_short})</span>
                    </div>
                  </div>
                </div>

                {/* 1. Summary KPIs */}
                <div className="pdf-section grid grid-cols-4 gap-2.5 mb-2.5">
                  <div className="pdf-card">
                    <div className="text-[9px] uppercase font-bold pdf-muted">{t.kpi_net_worth}</div>
                    <div className="text-sm font-bold font-mono text-slate-900">{formatCurrency(calculations.netWorth)}</div>
                  </div>
                  <div className="pdf-card">
                    <div className="text-[9px] uppercase font-bold pdf-muted">{t.total_assets_label}</div>
                    <div className="text-sm font-bold font-mono text-slate-900">{formatCurrency(calculations.totalAssets)}</div>
                  </div>
                  <div className="pdf-card">
                    <div className="text-[9px] uppercase font-bold pdf-muted">{t.total_debt_label}</div>
                    <div className="text-sm font-bold font-mono pdf-rose">{formatCurrency(calculations.totalLiabilities)}</div>
                  </div>
                  <div className="pdf-card">
                    <div className="text-[9px] uppercase font-bold pdf-muted">{t.kpi_runway}</div>
                    <div className={`text-sm font-bold font-mono ${calculations.runwayTotalMonths < 3 ? 'pdf-rose' : calculations.runwayTotalMonths < 6 ? 'pdf-amber' : 'pdf-green'}`}>
                      {calculations.runwayTotalMonths === Infinity ? '∞' : formatNumber(calculations.runwayTotalMonths, 1)} {t.kpi_months}
                    </div>
                  </div>
                </div>

                {/* 2. Full Assets Breakdown */}
                <div className="pdf-section pdf-card mb-2.5">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-1 mb-1.5">
                    <h3 className="font-bold text-[11px] uppercase pdf-green tracking-wider">1. {t.tab_assets} ({formatCurrency(calculations.totalAssets)})</h3>
                    <span className="text-[9.5px] pdf-muted font-bold">{t.gross_return_label}: {formatNumber(calculations.totalGrossReturnPct)}% ({t.net_after_tax.replace(/[:()]/g, '').trim()})</span>
                  </div>
                  <table>
                    <thead>
                      <tr className="font-bold text-slate-700 text-left">
                        <th>{t.col_name}</th>
                        <th className="text-center">{t.field_currency}</th>
                        <th className="text-right">{t.col_value}</th>
                        <th className="text-right">{t.col_cash_pct}</th>
                        <th className="text-right">{t.col_use_pct}</th>
                        <th className="text-right">{t.col_cap_pct}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {assets.map(a => (
                        <tr key={a.id}>
                          <td className="font-medium">
                            {a.name}
                            {a.subcategory === 'real_estate' && (
                              <span className="text-[8px] pdf-muted ml-1 font-mono">
                                ({USE_TYPE_LABEL[a.useType] || t.use_vacant})
                              </span>
                            )}
                            {(a.subcategory === 'stocks' || a.subcategory === 'pensions') && (
                              <span className="text-[8px] pdf-muted ml-1 font-mono">
                                ({a.subcategory === 'stocks' ? STOCK_CLASS_LABEL[stockClassOf(a)] : PENSION_TYPE_LABEL[pensionTypeOf(a)]})
                              </span>
                            )}
                          </td>
                          <td className="text-center font-mono">{a.currency}</td>
                          <td className="text-right font-mono font-bold">{formatCurrency(a.value, a.currency)}</td>
                          <td className={`text-right font-mono ${Number(a.cashReturnPct || 0) < 0 ? 'pdf-rose' : 'pdf-green'}`}>
                            {formatNumber(a.cashReturnPct)}%
                          </td>                              <td className="text-right font-mono pdf-sky">{formatNumber(a.useReturnPct)}%</td>
                          <td className="text-right font-mono pdf-purple">{formatNumber(a.capitalReturnPct)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* 3. Full Liabilities Breakdown */}
                <div className="pdf-section pdf-card mb-2.5">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-1 mb-1.5">
                    <h3 className="font-bold text-[11px] uppercase pdf-rose tracking-wider">2. {t.tab_liabilities} ({formatCurrency(calculations.totalLiabilities)})</h3>
                    <span className="text-[9.5px] pdf-muted font-bold">{t.weighted_interest_label}: {formatNumber(calculations.weightedInterestPct)}%</span>
                  </div>
                  <table>
                    <thead>
                      <tr className="font-bold text-slate-700 text-left">
                        <th>{t.col_name}</th>
                        <th className="text-center">{t.field_currency}</th>
                        <th className="text-right">{t.col_pending_balance}</th>
                        <th className="text-right">{t.col_interest_pct}</th>
                        <th className="text-right">{t.col_monthly_payment}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {liabilities.length === 0 ? (
                        <tr><td colSpan="5" className="text-center italic py-1.5">{t.col_no_items}</td></tr>
                      ) : (
                        liabilities.map(l => {
                          const { value: currentVal, monthlyPayment: currentMonthly } = resolveLiability(l, new Date(), { euriborPct });
                          return (
                            <tr key={l.id}>
                              <td className="font-medium">{l.name}</td>
                              <td className="text-center font-mono">{l.currency}</td>
                              <td className="text-right font-mono font-bold pdf-rose">{formatCurrency(currentVal, l.currency)}</td>
                              <td className="text-right font-mono">{formatNumber(l.interestRatePct)}%</td>
                              <td className="text-right font-mono pdf-rose">-{formatCurrency(currentMonthly, l.currency)}/m</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                {/* 4. Cashflow Waterfall & Expenses */}
                <div className="pdf-section grid grid-cols-2 gap-2.5 mb-2.5">
                  <div className="pdf-card">
                    <h3 className="font-bold text-[10.5px] uppercase pdf-sky border-b border-slate-200 pb-0.5 mb-1.5">{t.waterfall_title}</h3>
                    <div className="space-y-1.5 text-[9.5px]">
                      <div className="flex justify-between"><span>{t.wf_gross_cash}</span><span className={`font-mono font-bold ${calculations.monthlyPassiveCashflow >= 0 ? 'pdf-green' : 'pdf-rose'}`}>{calculations.monthlyPassiveCashflow >= 0 ? '+' : ''}{formatCurrency(calculations.monthlyPassiveCashflow)}/m</span></div>
                      <div className="flex justify-between"><span>{t.wf_debt_service}</span><span className="font-mono pdf-rose font-bold">-{formatCurrency(calculations.monthlyDebtPayments)}/m</span></div>
                      {calculations.monthlyWealthTax > 0 && (
                        <div className="flex justify-between"><span>{t.wf_wealth_tax}</span><span className="font-mono pdf-rose font-bold">-{formatCurrency(calculations.monthlyWealthTax)}/m</span></div>
                      )}
                      <div className="flex justify-between"><span>{t.wf_living_costs}</span><span className="font-mono pdf-amber font-bold">-{formatCurrency(calculations.totalMonthlyExpenses)}/m</span></div>
                      <div className="flex justify-between border-t border-slate-300 pt-1 font-bold">
                        <span>{t.wf_final_net_cash}</span>
                        <span className={`font-mono ${calculations.netMonthlyCashflow >= 0 ? 'pdf-green' : 'pdf-rose'}`}>
                          {calculations.netMonthlyCashflow >= 0 ? '+' : ''}{formatCurrency(calculations.netMonthlyCashflow)}/m
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pdf-card">
                    <h3 className="font-bold text-[10.5px] uppercase pdf-purple border-b border-slate-200 pb-0.5 mb-1.5">{t.card_expenses_summary}</h3>
                    <div className="space-y-1.5 text-[9.5px]">
                      <div className="flex justify-between"><span>{t.exp_group_person_monthly} ({validFamilyMembers} {t.people_short})</span><span className="font-mono font-bold">{formatCurrency(calculations.sumPersonMonthly * validFamilyMembers)}/m</span></div>
                      <div className="flex justify-between"><span>{t.exp_group_household_monthly}</span><span className="font-mono font-bold">{formatCurrency(calculations.sumHouseholdMonthly)}/m</span></div>
                      <div className="flex justify-between"><span>{t.exp_group_family_annual_month}</span><span className="font-mono font-bold">{formatCurrency(calculations.sumFamilyAnnual / 12)}/m</span></div>
                      <div className="flex justify-between border-t border-slate-300 pt-1 font-bold">
                        <span>{t.exp_total_monthly}</span>
                        <span className="font-mono">{formatCurrency(calculations.totalMonthlyExpenses)}/m</span>
                      </div>
                    </div>
                  </div>
                </div>

               {/* 5. Auditoría en dos ejes, desde el mismo motor que la app */}
                <div className="pdf-section pdf-card mb-2.5">
                  <div className="flex justify-between items-center border-b border-slate-200 pb-1 mb-1.5">
                    <h3 className="font-bold text-[11px] uppercase pdf-purple tracking-wider">3. {t.ai_main_title}</h3>
                    <div className="flex items-center gap-1.5 text-[10px] font-sans font-bold">
                      <span className="px-2 py-0.5 rounded border border-purple-300 bg-purple-50 text-purple-900">
                        {t.audit_axis_structure} {formatNumber(audit.structure.score, 0)}
                      </span>
                      <span className="px-2 py-0.5 rounded border border-sky-300 bg-sky-50 text-sky-900">
                        {t.audit_axis_support} {formatNumber(audit.support.score, 0)}
                      </span>
                      <span className={`px-2 py-0.5 rounded border ${healthScoreClass}`}>
                        {t.ai_score_label}: {formatNumber(audit.combined, 0)}/100
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-x-2.5 gap-y-1.5 text-[9px]">
                    {audit.dimensions.map(d => {
                      const na = !d.applicable || d.points === null;
                      return (
                        <div key={d.id} className="border border-slate-200 rounded p-1.5 bg-slate-50">
                          <div className="flex justify-between font-bold gap-2">
                            <span>{t[`audit_dim_${d.id}`]}</span>
                            <span className="whitespace-nowrap">{na ? t.audit_na : `${formatNumber(d.points, 1)}/${d.max} pts`}</span>
                          </div>
                          <p className="pdf-muted mt-0.5">
                            {na ? t[`audit_na_${d.id}`] : renderDimensionReading(d)}
                          </p>
                        </div>
                      );
                    })}
                  </div>

                  {audit.cap && (
                    <p className="pdf-rose text-[9px] font-bold mt-1.5">
                      {t.audit_cap_negative_equity.replace('{limit}', String(audit.cap.limit))}
                    </p>
                  )}

                  <p className="pdf-muted text-[8px] mt-1.5">
                    {t.audit_assumptions_title}: {t.params_inflation_label.replace(' (%)', '')} {formatNumber(audit.assumptions.inflationPct)}% ·{' '}
                    {t.audit_assumption_savings_tax} {formatNumber(audit.assumptions.savingsTaxRatePct)}% ·{' '}
                    {t.audit_assumption_marginal_tax} {formatNumber(audit.assumptions.marginalIncomeTaxPct)}% ·{' '}
                    {t.audit_assumption_fire} {formatNumber(audit.assumptions.fireTargetMultiple, 0)}x
                  </p>
                </div>

                {/* 6. Paso a la Libertad Financiera Section */}
                <div className="pdf-section pdf-card mb-2">
                  <div className="border-b border-slate-200 pb-1 mb-1.5 flex justify-between items-center">
                    <h3 className="font-bold text-[11px] uppercase text-emerald-800 tracking-wider">
                      4. {t.fire_roadmap_title}
                    </h3>
                    <span className="text-[9.5px] font-bold pdf-muted">
                      {passedLevels >= 7 
                        ? t.fire_all_achieved
                        : t.fire_current_step.replace('{n}', String(currentStepInfo.level))
                      }
                    </span>
                  </div>

                  <div className="flex items-stretch gap-3">
                    {/* Current Milestone Card */}
                    <div className={`flex-1 p-2 rounded-lg border ${
                      isCurrentPassed 
                        ? 'border-emerald-400 bg-emerald-50/70' 
                        : 'border-amber-400 bg-amber-50/70'
                    } flex flex-col justify-between`}>
                      <div>
                    <div className="flex justify-between items-center font-bold text-[10px] mb-0.5">
                          <span className={isCurrentPassed ? 'text-emerald-950' : 'text-amber-950'}>
                            {t.fire_level_current.replace('{n}', String(currentStepInfo.level))}
                          </span>
                          <span className={`font-sans text-[9px] px-1.5 py-0.5 rounded font-bold ${
                            isCurrentPassed 
                              ? 'bg-emerald-200 text-emerald-900 border border-emerald-400' 
                              : 'bg-amber-200 text-amber-900 border border-amber-400'
                          }`}>
                            {isCurrentPassed 
                              ? t.fire_passed 
                              : t.fire_in_progress}
                          </span>
                        </div>
                        <strong className="text-[10px] block text-slate-900 leading-tight">{currentStepInfo.title}</strong>
                        <p className="text-[9px] text-slate-700 mt-0.5 leading-tight">{currentStepInfo.desc}</p>
                      </div>
                    </div>

                    {/* Arrow Right */}
                    <div className="flex items-center justify-center px-0.5 text-slate-400 font-bold text-lg select-none">
                      ➔
                    </div>

                    {/* Target Milestone Card (Blue) */}
                    <div className="flex-1 p-2 rounded-lg border border-sky-400 bg-sky-50/70 flex flex-col justify-between">
                      {targetStepIdx >= 7 ? (
                        <div>
                          <div className="flex justify-between items-center font-bold text-[10px] text-sky-950 mb-0.5">
                            <span>{t.fire_next_goal}</span>
                            <span className="font-sans text-[9px] bg-sky-200 text-sky-900 border border-sky-400 px-1.5 py-0.5 rounded font-bold">
                              {t.fire_target_short}
                            </span>
                          </div>
                          <strong className="text-[10px] block text-sky-950 leading-tight">
                            {t.fire_share_cta}
                          </strong>
                          <p className="text-[9px] text-slate-700 mt-0.5 leading-tight">
                            {lang === 'es' 
                              ? 'Tu patrimonio ya es autosuficiente y abundante. Comparte tu conocimiento y recursos para guiar a tu entorno.' 
                              : 'Your wealth is abundant and self-sufficient. Share your knowledge to mentor and support your community.'}
                          </p>
                        </div>
                      ) : (
                        <div>
                          <div className="flex justify-between items-center font-bold text-[10px] text-sky-950 mb-0.5">
                            <span>
                              {targetStepIdx === 0 && !isCurrentPassed 
                                ? t.fire_next_target_zero
                                : t.fire_next_target_n.replace('{n}', String(targetStepInfo.level))
                              }
                            </span>
                            <span className="font-sans text-[9px] bg-sky-200 text-sky-900 border border-sky-400 px-1.5 py-0.5 rounded font-bold">🎯 Meta</span>
                          </div>
                          <strong className="text-[10px] block text-sky-950 leading-tight">{targetStepInfo.title}</strong>
                          <p className="text-[9px] text-slate-700 mt-0.5 leading-tight">{targetStepInfo.desc}</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>

            {/* Legal Disclaimer in PDF */}
                <div className="text-center pt-1.5 border-t border-slate-200 text-[8px] leading-tight text-slate-500 pdf-muted">
                  {t.disclaimer_pdf}
                </div>

                {/* 7. Dynamic Footer Link */}
                <div className="text-center pt-1 text-[9.5px] pdf-muted">
                  {t.report_make_your_own}{' '}
                  <span className="font-bold text-slate-900 underline">{currentSiteUrl}</span>
                </div>
              </>
            );
          })()}
        </div>

        
        {/* MODAL ACTIVOS */}
        {editingAsset && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
               onMouseDown={e => { if (e.target === e.currentTarget) setEditingAsset(null); }}>
            <div role="dialog" aria-modal="true" data-modal="asset" aria-label={t.tab_assets} className={`border rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 ${themeClasses.modalBg}`}>
              <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
                <h3 className={`font-bold text-base ${themeClasses.textTitle}`}>
                  {isNewAsset ? `${t.modal_add_prefix} ${t[`type_${editingAsset.subcategory}`]}` : `${t.modal_edit_prefix} ${t[`type_${editingAsset.subcategory}`]}`}
                </h3>
                  <button onClick={() => setEditingAsset(null)} aria-label={t.btn_close} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle}`}>✕</button>
              </div>

              <form onSubmit={handleSaveAsset} className="space-y-3 text-xs">
                {!isNewAsset && (
                  <div>
                    <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_subcategory}</label>
                    <select
                      value={editingAsset.subcategory}
                      onChange={e => setEditingAsset({ ...editingAsset, subcategory: e.target.value })}
                      className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                    >
                      {['cash', 'stocks', 'real_estate', 'pensions', 'tangibles'].map(k => (
                        <option key={k} value={k}>{t[`type_${k}`]}</option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_name}</label>
                  <input
                    type="text"
                    required
                    value={editingAsset.name}
                    onChange={e => setEditingAsset({ ...editingAsset, name: e.target.value })}
                    className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                  />
                </div>

                {editingAsset.subcategory === 'stocks' ? (
                  <>
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_stock_class}</label>
                      <select
                        value={stockClassOf(editingAsset)}
                        onChange={e => changeStockClass(e.target.value)}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      >
                        {STOCK_CLASSES.map(k => (
                          <option key={k} value={k}>{STOCK_CLASS_LABEL[k]}</option>
                        ))}
                      </select>
                    </div>

                    {isEquityClass(editingAsset) && (
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_stock_type}</label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setEditingAsset({ ...editingAsset, stockType: 'shares' })}
                          className={`p-2 rounded-lg border font-bold transition ${editingAsset.stockType === 'shares' ? 'bg-emerald-500 text-slate-950 border-emerald-500' : `${themeClasses.btnSecondary} border-transparent`}`}
                        >
                          {t.stock_type_shares}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingAsset({ ...editingAsset, stockType: 'fund' })}
                          className={`p-2 rounded-lg border font-bold transition ${editingAsset.stockType === 'fund' ? 'bg-emerald-500 text-slate-950 border-emerald-500' : `${themeClasses.btnSecondary} border-transparent`}`}
                        >
                          {t.stock_type_fund}
                        </button>
                      </div>
                    </div>
                    )}

                    {isEquityClass(editingAsset) && editingAsset.stockType === 'shares' ? (
                      <>
                        <div>
                          <label className={`block mb-1 font-bold ${themeClasses.textTitle}`}>{t.field_market}</label>
                          <select
                            value={editingAsset.market || ''}
                           onChange={e => {
                            const m = e.target.value;
                            const marketObj = STOCK_MARKETS.find(x => x.id === m);
                            setEditingAsset({
                              ...editingAsset,
                              market: m,
                                name: m === 'OTRO' ? (editingAsset.name || '') : editingAsset.name,
                                ticker: m === 'OTRO' ? (editingAsset.name || 'CUSTOM') : '',
                                currency: marketObj ? marketObj.currency : baseCurrency,
                                sharesCount: editingAsset.sharesCount || 1,
                                sharePrice: editingAsset.sharePrice || 0
                            });
                            setTickerQuery('');
                            setShowTickerDropdown(false);
                          }}
                            className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                          >
                            <option value="">{t.select_market_prompt}</option>
                            {STOCK_MARKETS.map(m => (
                              <option key={m.id} value={m.id}>{m.name}</option>
                            ))}
                          </select>
                        </div>
                  {editingAsset.market === 'OTRO' ? (
                          <div>
                            <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.custom_ticker_label}</label>
                            <input
                              type="text"
                              placeholder={t.custom_ticker_placeholder}
                              value={editingAsset.name}
                              onChange={e => setEditingAsset({ ...editingAsset, name: e.target.value, ticker: e.target.value })}
                              className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                            />
                          </div>
                        ) : (
                          <div className="relative">
                            <label className={`block mb-1 font-bold ${themeClasses.textTitle}`}>{t.field_ticker}</label>
                          <input
                              type="text"
                              placeholder={t.ticker_search_placeholder}
                              value={tickerQuery}
                              onFocus={() => setShowTickerDropdown(true)}
                              onBlur={() => setTimeout(() => setShowTickerDropdown(false), 200)}
                              onChange={e => {
                                const val = e.target.value;
                                setTickerQuery(val);
                                setShowTickerDropdown(true);
                                setEditingAsset({
                                  ...editingAsset,
                                  ticker: val,
                                  name: val
                                });
                              }}
                              className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                            />

                              {showTickerDropdown && availableTickersForMarket.length > 0 && (
                                <div 
                                  onMouseDown={(e) => e.preventDefault()}
                                  className={`absolute top-full left-0 right-0 mt-1 rounded-xl shadow-2xl z-50 max-h-48 overflow-y-auto divide-y ${isDark ? 'bg-slate-900 border border-slate-700 divide-slate-800' : 'bg-white border border-slate-300 divide-slate-100'}`}
                                >        
                                  {availableTickersForMarket.map(item => (
                                  <div
                                    key={item.ticker}
                                    tabIndex={0}
                                    onKeyDown={(e) => {
                                      if (e.key === 'Enter' || e.key === ' ') {
                                        e.preventDefault();
                                        setEditingAsset({
                                          ...editingAsset,
                                          ticker: item.ticker,
                                          name: item.name,
                                          sharePrice: item.price,
                                          currency: item.currency,
                                          cashReturnPct: item.divYield
                                        });
                                        setTickerQuery(`${item.ticker} - ${item.name}`);
                                        setShowTickerDropdown(false);
                                      }
                                    }}
                                    onClick={() => {
                                      setEditingAsset({
                                        ...editingAsset,
                                        ticker: item.ticker,
                                        name: item.name,
                                        sharePrice: item.price,
                                        currency: item.currency,
                                        cashReturnPct: item.divYield
                                      });
                                      setTickerQuery(`${item.ticker} - ${item.name}`);
                                      setShowTickerDropdown(false);
                                    }}
                                    className={`p-2.5 cursor-pointer flex justify-between items-center text-xs outline-none focus:bg-brand-accent/20 hover:bg-brand-cardInner text-brand-text`}
                                  >
                                    <div>
                                      <strong className="text-emerald-700 dark:text-emerald-400 font-mono">{item.ticker}</strong>
                                      <span className="ml-2 font-sans">{item.name}</span>
                                    </div>
                                    <div className="text-right font-mono text-slate-700 dark:text-slate-300">
                                      <span>{formatCurrency(item.price, item.currency)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Always visible inputs for Number of Shares, Share Price & Currency */}
                        <div className={`space-y-3 p-3 rounded-xl border ${isDark ? 'border-emerald-500/20 bg-emerald-950/10' : 'border-emerald-200 bg-emerald-50/50'}`}>
                          <div className="grid grid-cols-3 gap-2 items-end">
                            <div>
                              <label className={`block mb-1 font-bold ${themeClasses.textTitle} text-[11px] min-h-[28px] flex items-end font-sans`}>
                                {t.field_shares_count}
                              </label>
                            <FormattedNumberInput
                                value={editingAsset.sharesCount ?? 0}
                                decimals={2}
                                min={0}
                                onChange={v => setEditingAsset({
                                  ...editingAsset,
                                  sharesCount: v,
                                  value: Math.round((v * (Number(editingAsset.sharePrice) || 0)) * 100) / 100
                                })}
                                className={`w-full h-10 border rounded-lg p-2 font-mono text-xs outline-none ${themeClasses.input}`}
                              />
                            </div>
                            <div>
                              <label className={`block mb-1 font-bold ${themeClasses.textTitle} text-[11px] min-h-[28px] flex items-end font-sans`}>
                                {t.field_share_price}
                              </label>
                              <FormattedNumberInput
                                value={editingAsset.sharePrice || 0}
                                decimals={2}
                                onChange={v => setEditingAsset({ ...editingAsset, sharePrice: v })}
                                min={0}
                                className={`w-full h-10 border rounded-lg p-2 font-mono text-xs outline-none ${themeClasses.input}`}
                              />
                            </div>
                            <div>
                              <label className={`block mb-1 font-bold ${themeClasses.textTitle} text-[11px] min-h-[28px] flex items-end font-sans`}>
                                {t.field_currency}
                              </label>
                              <select
                                value={editingAsset.currency || baseCurrency}
                                onChange={e => setEditingAsset({ ...editingAsset, currency: e.target.value })}
                                className={`w-full h-10 border rounded-lg p-2 text-xs outline-none ${themeClasses.input}`}
                              >
                                {ALL_SUPPORTED_CURRENCIES.map(c => (
                                  <option key={c.code} value={c.code}>{c.code}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="flex justify-between items-center pt-2 border-t border-slate-200 dark:border-slate-800 text-xs">
                            <span className={`${themeClasses.textMuted} font-sans`}>{t.total_calculated_value}</span>
                            <strong className="text-emerald-700 dark:text-emerald-400 text-sm font-bold font-mono">
                              {formatCurrency(Math.round((Number(editingAsset.sharesCount || 0) * Number(editingAsset.sharePrice || 0)) * 100) / 100, editingAsset.currency || baseCurrency)}
                            </strong>
                          </div>
                        </div>


                      <div className="grid grid-cols-2 gap-3 items-end pt-1">
                        <div>
                          <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-10 flex items-end font-bold font-sans`}>{t.field_cash_pct}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={editingAsset.cashReturnPct}
                              decimals={2}
                              onChange={v => setEditingAsset({ ...editingAsset, cashReturnPct: v })}
                              className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                          </div>
                        </div>
                        <div>
                          <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-10 flex items-end font-bold font-sans`}>{t.field_cap_pct}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={editingAsset.capitalReturnPct !== undefined ? editingAsset.capitalReturnPct : macroParams.stockGrowthPct}
                              decimals={2}
                              onChange={v => setEditingAsset({ ...editingAsset, capitalReturnPct: v })}
                              className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-3 gap-3">
                        <div className="col-span-2">
                          <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_value}</label>
                          <FormattedNumberInput
                            value={editingAsset.value}
                            onChange={v => setEditingAsset({ ...editingAsset, value: v })}
                            min={0}
                            className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                          />
                        </div>
                        <div>
                          <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_currency}</label>
                          <select
                            value={editingAsset.currency}
                            onChange={e => setEditingAsset({ ...editingAsset, currency: e.target.value })}
                            className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                          >
                            {ALL_SUPPORTED_CURRENCIES.map(c => (
                              <option key={c.code} value={c.code}>{c.code}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                      {isEquityClass(editingAsset) && (
                      <div className="grid grid-cols-2 gap-3 items-end pt-1">
                        <div>
                          <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-10 flex items-end font-bold font-sans`}>{t.field_cash_pct}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={editingAsset.cashReturnPct}
                              decimals={2}
                              onChange={v => setEditingAsset({ ...editingAsset, cashReturnPct: v })}
                              className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                          </div>
                        </div>
                        <div>
                          <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-10 flex items-end font-bold font-sans`}>{t.field_cap_pct}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={editingAsset.capitalReturnPct !== undefined ? editingAsset.capitalReturnPct : macroParams.stockGrowthPct}
                              decimals={2}
                              onChange={v => setEditingAsset({ ...editingAsset, capitalReturnPct: v })}
                              className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                          </div>
                        </div>
                      </div>
                      )}
                      {stockClassOf(editingAsset) === 'bonds' && (
                        <div>
                          <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_bond_coupon_pct}</label>
                          <div className="relative flex items-center">
                            <FormattedNumberInput
                              value={editingAsset.cashReturnPct}
                              decimals={2}
                              onChange={v => setEditingAsset({ ...editingAsset, cashReturnPct: v })}
                              className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                            />
                            <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                          </div>
                          <p className={`text-[11px] ${themeClasses.textMuted} mt-1 font-sans leading-snug`}>{t.stock_class_hint_bonds}</p>
                        </div>
                      )}
                      {['tips', 'gold'].includes(stockClassOf(editingAsset)) && (() => {
                        const esTips = stockClassOf(editingAsset) === 'tips';
                        const real = Number(esTips ? macroParams.tipsRealYieldPct : macroParams.goldRealReturnPct) || 0;
                        const inflacion = Number(macroParams.inflationPct) || 0;
                        return (
                          <p className={`p-3 rounded-xl border text-[11px] font-sans leading-snug ${themeClasses.cardInner}`}>
                            {(esTips ? t.stock_class_hint_tips : t.stock_class_hint_gold)
                              .replaceAll('{inflation}', formatNumber(inflacion))
                              .replaceAll('{real}', formatNumber(real))
                              .replaceAll('{total}', formatNumber(inflacion + real))}
                          </p>
                        );
                      })()}
                    </>
                  )}
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_value}</label>
                      <FormattedNumberInput
                        value={editingAsset.value}
                        onChange={v => setEditingAsset({ ...editingAsset, value: v })}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                    </div>
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_currency}</label>
                      <select
                        value={editingAsset.currency}
                        onChange={e => setEditingAsset({ ...editingAsset, currency: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      >
                        {ALL_SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>{c.code}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Solo donde hay plusvalía que tributar al vender. La caja no
                      gana nada y el rescate de un plan va por otra vía. */}
                  {(editingAsset.subcategory === 'stocks' || editingAsset.subcategory === 'real_estate') && (
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_acquisition_cost}</label>
                      <FormattedNumberInput
                        value={editingAsset.acquisitionCost || 0}
                        onChange={v => setEditingAsset({ ...editingAsset, acquisitionCost: v })}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                      <p className={`text-[11px] ${themeClasses.textMuted} mt-1 font-sans leading-snug`}>{t.field_acquisition_cost_hint}</p>
                    </div>
                  )}

                  {editingAsset.subcategory === 'real_estate' && (
                    <>
                      <div className="grid grid-cols-2 gap-3 items-end">
                        <div>
                          <label className={`block mb-1 font-bold ${themeClasses.textMuted} text-xs min-h-[32px] flex items-end font-sans`}>
                            {t.field_use_type}
                          </label>
                          <select
                            value={editingAsset.useType || 'habitual'}
                            onChange={e => setEditingAsset({ ...editingAsset, useType: e.target.value })}
                            className={`w-full h-10 border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                          >
                            <option value="habitual">{t.use_habitual}</option>
                            <option value="rented">{t.use_rented}</option>
                            <option value="vacant">{t.use_vacant}</option>
                            <option value="land">{t.use_land}</option>
                          </select>
                        </div>
                        {editingAsset.useType !== 'land' && (
                        <div>
                          <label className={`block mb-1 font-bold ${themeClasses.textMuted} text-xs min-h-[32px] flex items-end font-sans`}>
                            {t.field_monthly_rent}
                          </label>
                          <FormattedNumberInput
                            value={editingAsset.monthlyRent || 0}
                            onChange={v => setEditingAsset({ ...editingAsset, monthlyRent: v })}
                            min={0}
                            className={`w-full h-10 border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                          />
                        </div>
                        )}
                      </div>
                      {editingAsset.useType === 'land' && (
                        <p className={`text-[11px] ${themeClasses.textMuted} font-sans leading-snug`}>{t.use_land_hint}</p>
                      )}

                      {(() => {
                        const r = calculateRealEstateReturns(
                          editingAsset.value,
                          editingAsset.monthlyRent,
                          editingAsset.useType || 'habitual',
                          macroParams
                        );
                        return (
                          <div className={`p-3 rounded-xl border space-y-1.5 text-xs ${themeClasses.cardInner}`}>
                          <div className="flex justify-between items-center font-sans">
                            <span className={themeClasses.textMuted}>{t.col_cash_pct} {t.net_after_tax}</span>
                            <strong className={`font-bold font-mono ${
                              r.cashReturnPct < 0 
                                ? 'text-rose-700 dark:text-rose-400' 
                                : 'text-emerald-700 dark:text-emerald-400'
                            }`}>
                              {formatNumber(r.cashReturnPct)}%
                            </strong>
                          </div>
                            <div className="flex justify-between items-center font-sans">
                              <span className={themeClasses.textMuted}>{t.col_use_pct}:</span>
                              <strong className="text-sky-700 dark:text-sky-400 font-bold font-mono">{formatNumber(r.useReturnPct)}%</strong>
                            </div>
                            <div className="flex justify-between items-center font-sans">
                              <span className={themeClasses.textMuted}>{t.col_cap_pct}:</span>
                              <strong className="text-purple-700 dark:text-purple-400 font-bold font-mono">{formatNumber(r.capitalReturnPct)}%</strong>
                            </div>
                          </div>
                        );
                      })()}
                    </>
                  )}

                  {editingAsset.subcategory === 'cash' && (
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_cash_pct}</label>
                      <div className="relative flex items-center">
                        <FormattedNumberInput
                          value={editingAsset.cashReturnPct}
                          decimals={2}
                          onChange={v => setEditingAsset({ ...editingAsset, cashReturnPct: v })}
                          className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                        />
                        <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                      </div>
                    </div>
                  )}

                  {editingAsset.subcategory === 'pensions' && (
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_pension_type}</label>
                      <select
                        value={pensionTypeOf(editingAsset)}
                        onChange={e => setEditingAsset({ ...editingAsset, pensionType: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      >
                        {PENSION_TYPES.map(k => (
                          <option key={k} value={k}>{PENSION_TYPE_LABEL[k]}</option>
                        ))}
                      </select>
                      <p className={`text-[11px] ${themeClasses.textMuted} mt-1 font-sans leading-snug`}>{t.pension_type_hint}</p>
                    </div>
                  )}

                  {editingAsset.subcategory === 'pensions' && (
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_cap_pct}</label>
                      <div className="relative flex items-center">
                        <FormattedNumberInput
                          value={editingAsset.capitalReturnPct}
                          decimals={2}
                          onChange={v => setEditingAsset({ ...editingAsset, capitalReturnPct: v })}
                          className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                        />
                        <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                      </div>
                    </div>
                  )}

                  {editingAsset.subcategory === 'tangibles' && (
                    <div className="grid grid-cols-3 gap-2 pt-1 items-end">
                      <div>
                        <label className={`block text-[11px] ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-sans`}>{t.field_tangible_cap_pct}</label>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={editingAsset.capitalReturnPct}
                            decimals={2}
                            onChange={v => setEditingAsset({ ...editingAsset, capitalReturnPct: v })}
                            className={`w-full border rounded p-2 pr-6 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2 text-[10px] text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                      <div>
                        <label className={`block text-[11px] ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-sans`}>{t.field_tangible_use_pct}</label>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={editingAsset.useReturnPct}
                            decimals={2}
                            onChange={v => setEditingAsset({ ...editingAsset, useReturnPct: v })}
                            className={`w-full border rounded p-2 pr-6 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2 text-[10px] text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                      <div>
                        <label className={`block text-[11px] ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-sans`} title={t.field_tangible_cash_desc}>
                          {t.field_cash_pct} ⓘ
                        </label>
                        <div className="relative flex items-center">
                          <FormattedNumberInput
                            value={editingAsset.cashReturnPct}
                            decimals={2}
                            onChange={v => setEditingAsset({ ...editingAsset, cashReturnPct: v })}
                            className={`w-full border rounded p-2 pr-6 font-mono text-xs ${themeClasses.input}`}
                          />
                          <span className="absolute right-2 text-[10px] text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="pt-3 flex gap-2 font-sans">
                {!isNewAsset && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(t.confirm_delete_item.replace('{name}', editingAsset.name || ''))) return;
                      deleteWithUndo('assets', assets, t.undo_deleted_one.replace('{name}', editingAsset.name || ''));
                      setAssets(assets.filter(a => a.id !== editingAsset.id));
                      setEditingAsset(null);
                    }}
                    className="bg-rose-100 hover:bg-rose-200 text-rose-950 border border-rose-400 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30 px-3 py-2.5 rounded-lg font-bold"
                  >
                    {t.btn_delete}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingAsset(null)}
                  className={`flex-1 py-2.5 rounded-lg font-bold ${themeClasses.btnSecondary}`}
                >
                  {t.btn_cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-brand-emerald hover:bg-emerald-400 text-slate-950 py-2.5 rounded-lg font-bold"
                >
                  {t.btn_save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL PASIVOS */}
      {editingLiability && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
             onMouseDown={e => { if (e.target === e.currentTarget) setEditingLiability(null); }}>
          <div role="dialog" aria-modal="true" data-modal="liability" aria-label={t.tab_liabilities} className={`border rounded-2xl p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 ${themeClasses.modalBg}`}>
            <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
              <h3 className={`font-bold text-base ${themeClasses.textTitle}`}>
                {isNewLiability ? `${t.modal_add_prefix} ${t[`type_${editingLiability.subcategory}`]}` : `${t.modal_edit_prefix} ${t[`type_${editingLiability.subcategory}`]}`}
              </h3>
              <button onClick={() => setEditingLiability(null)} aria-label={t.btn_close} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle}`}>✕</button>
            </div>

            <form onSubmit={handleSaveLiability} className="space-y-3 text-xs">
              {!isNewLiability && (
                <div>
                  <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_subcategory}</label>
                  <select
                    value={editingLiability.subcategory}
                    onChange={e => setEditingLiability({ ...editingLiability, subcategory: e.target.value })}
                    className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                  >
                    {['short_term', 'personal_loans', 'family_loans', 'mortgages'].map(k => (
                      <option key={k} value={k}>{t[`type_${k}`]}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_name}</label>
                <input
                  type="text"
                  required
                  value={editingLiability.name}
                  onChange={e => setEditingLiability({ ...editingLiability, name: e.target.value })}
                  className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                />
              </div>

              {editingLiability.subcategory === 'mortgages' || editingLiability.subcategory === 'personal_loans' ? (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>
                        {editingLiability.subcategory === 'personal_loans' ? t.field_pending_amount : t.field_initial_amount}
                      </label>
                      <FormattedNumberInput
                        value={editingLiability.initialPrincipal || 0}
                        onChange={v => setEditingLiability({ ...editingLiability, initialPrincipal: v })}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                    </div>
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_currency}</label>
                      <select
                        value={editingLiability.currency}
                        onChange={e => setEditingLiability({ ...editingLiability, currency: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      >
                        {ALL_SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>{c.code}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className={`grid gap-3 items-end ${editingLiability.subcategory === 'personal_loans' ? 'grid-cols-2' : 'grid-cols-3'}`}>
                    {/* Solo la hipoteca arrastra histórico. Un préstamo
                        personal se declara por lo que queda: saldo y meses
                        que faltan, sin fecha de inicio que reconstruir. */}
                    {editingLiability.subcategory !== 'personal_loans' && (
                      <div>
                        <label className={`block mb-1 ${themeClasses.textMuted} min-h-[32px] flex items-end`}>{t.field_start_date}</label>
                        <input
                          type="month"
                          required
                          value={editingLiability.startDate || '2023-01'}
                          onChange={e => setEditingLiability({ ...editingLiability, startDate: e.target.value })}
                          className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                        />
                      </div>
                    )}
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted} min-h-[32px] flex items-end`}>
                        {editingLiability.subcategory === 'personal_loans' ? t.field_remaining_months : t.field_duration_months}
                      </label>
                      {/* `min={1}` porque un plazo de cero meses no es un plazo: la deuda se
                          quedaba sin cuadro, sin cuota y, al guardar la copia, volvía
                          convertida en un préstamo a veinte años. Y `??` en vez de `||`
                          porque el campo enseñaba 48 mientras el estado valía 0: el usuario
                          creía haber escrito un plazo que no estaba ahí. */}
                      <FormattedNumberInput
                        value={editingLiability.durationMonths ?? (editingLiability.subcategory === 'mortgages' ? 300 : 48)}
                        onChange={v => setEditingLiability({ ...editingLiability, durationMonths: v })}
                        min={1}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                    </div>
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted} min-h-[32px] flex items-end whitespace-nowrap`}>
                        {editingLiability.rateType === 'variable' ? t.field_spread : t.field_interest_rate}
                      </label>
                      <div className="relative flex items-center">
                        {/* Un tipo de deuda negativo no es un producto que exista, y el cuadro
                            de amortización lo neutraliza igualmente con un Math.max(0). El
                            diferencial se queda sin suelo: una hipoteca referenciada a euríbor
                            menos algo es rara, pero no imposible. */}
                        <FormattedNumberInput
                          value={editingLiability.rateType === 'variable'
                            ? (editingLiability.spreadPct ?? DEFAULT_MORTGAGE_SPREAD_PCT)
                            : editingLiability.interestRatePct}
                          decimals={2}
                          min={editingLiability.rateType === 'variable' ? undefined : 0}
                          onChange={v => setEditingLiability(editingLiability.rateType === 'variable'
                            ? { ...editingLiability, spreadPct: v }
                            : { ...editingLiability, interestRatePct: v })}
                          className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                        />
                        <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                      </div>
                    </div>
                  </div>

                  {/* La mayoría de las hipotecas españolas son variables: el
                      usuario pone su diferencial y el euríbor lo trae el
                      fichero de datos de mercado. */}
                  <div>
                    <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_rate_type}</label>
                    <select
                      value={editingLiability.rateType === 'variable' ? 'variable' : 'fixed'}
                      onChange={e => {
                        const rateType = e.target.value;
                        // Al pasar a variable hay que dejar un diferencial en el
                        // estado, no solo en la casilla: si se queda indefinido, el
                        // campo enseña el 1,0 por defecto pero el cálculo aplica 0 y
                        // el tipo mostrado no es el que se usa.
                        setEditingLiability(rateType === 'variable'
                          ? { ...editingLiability, rateType, spreadPct: editingLiability.spreadPct ?? DEFAULT_MORTGAGE_SPREAD_PCT }
                          : { ...editingLiability, rateType });
                      }}
                      className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                    >
                      <option value="fixed">{t.field_rate_fixed}</option>
                      <option value="variable">{t.field_rate_variable}</option>
                    </select>
                    {editingLiability.rateType === 'variable' && (
                      <p className={`text-[11px] ${themeClasses.textMuted} mt-1 font-sans leading-snug`}>
                        {euribor
                          ? t.field_euribor_now
                              .replaceAll('{rate}', formatNumber(euribor.ratePct, 3))
                              .replaceAll('{period}', euribor.period || '—')
                              .replaceAll('{applied}', formatNumber(effectiveInterestRatePct(editingLiability, euriborPct), 2))
                          : t.field_euribor_missing
                              .replaceAll('{applied}', formatNumber(effectiveInterestRatePct(editingLiability, null), 2))}
                      </p>
                    )}
                  </div>

                  {/* Anclar el saldo solo tiene sentido donde hay un cuadro
                      del que apartarse. En el préstamo personal el saldo ya
                      es lo que el usuario escribe arriba. */}
                  {editingLiability.subcategory !== 'personal_loans' && (
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_balance_override}</label>
                      <FormattedNumberInput
                        value={editingLiability.balanceOverride || 0}
                        onChange={v => setEditingLiability({ ...editingLiability, balanceOverride: v })}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                      <p className={`text-[11px] ${themeClasses.textMuted} mt-1 font-sans leading-snug`}>{t.field_balance_override_hint}</p>
                    </div>
                  )}

                  {(() => {
                    // Misma función que usa el balance, para que lo que se
                    // ve aquí sea exactamente lo que se va a guardar.
                    const c = resolveLiability(editingLiability, new Date(), { euriborPct });
                    return (
                      <div className={`p-2.5 rounded-lg border space-y-1 text-[11px] ${themeClasses.cardInner}`}>
                        <div className="flex justify-between font-sans">
                          <span className={themeClasses.textMuted}>{t.field_calculated_monthly}:</span>
                          <strong className="text-rose-700 dark:text-rose-400 font-bold font-mono">-{formatCurrency(c.monthlyPayment, editingLiability.currency)}{t.per_month_short}</strong>
                        </div>
                        {/* En el préstamo personal esta línea repetiría el
                            saldo que se acaba de escribir: no hay cuadro
                            que recorrer, así que no informa de nada. */}
                        {editingLiability.subcategory !== 'personal_loans' && (
                          <div className="flex justify-between font-sans">
                            <Tooltip text={t.tt_amort}>
                              <span className={themeClasses.textMuted}>{t.field_calculated_balance} ⓘ:</span>
                            </Tooltip>
                            <strong className={`${themeClasses.textTitle} font-mono`}>{formatCurrency(c.value, editingLiability.currency)}</strong>
                          </div>
                        )}
                        {c.isAnchored && (
                          <p className="text-[10px] text-emerald-700 dark:text-emerald-400 font-sans leading-snug pt-0.5">
                            {t.field_balance_anchored}
                          </p>
                        )}
                      </div>
                    );
                  })()}
                </>
              ) : editingLiability.subcategory === 'family_loans' ? (
                <>
                  <div className="grid grid-cols-5 gap-3 items-end">
                    <div className="col-span-3">
                      <label className={`block mb-1 ${themeClasses.textMuted} min-h-[32px] flex items-end`}>{t.field_family_amount}</label>
                      <FormattedNumberInput
                        value={editingLiability.value || 0}
                        onChange={v => {
                          const months = Number(editingLiability.durationMonths) || 1;
                          const rate = Number(editingLiability.interestRatePct) || 0;
                          setEditingLiability({
                            ...editingLiability,
                            value: v,
                            monthlyPayment: calculateFamilyLoanPayment(v, rate, months)
                          });
                        }}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={`block mb-1 ${themeClasses.textMuted} min-h-[32px] flex items-end whitespace-nowrap`}>{t.field_interest_rate}</label>
                      <div className="relative flex items-center">
                        <FormattedNumberInput
                          value={editingLiability.interestRatePct || 0}
                          decimals={2}
                          min={0}
                          onChange={newRate => {
                            const principal = Number(editingLiability.value) || 0;
                            const months = Number(editingLiability.durationMonths) || 1;
                            setEditingLiability({
                              ...editingLiability,
                              interestRatePct: newRate,
                              monthlyPayment: calculateFamilyLoanPayment(principal, newRate, months)
                            });
                          }}
                          className={`w-full border rounded-lg p-2.5 pr-7 font-mono outline-none ${themeClasses.input}`}
                        />
                        <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                      </div>
                    </div>
                  </div>

                  {/* Una fianza de alquiler o un préstamo de un familiar no
                      se devuelven a plazos: se devuelven de golpe algún día.
                      Marcado esto, el balance explica por qué esa deuda no
                      paga nada al mes en vez de enseñar un «-0 €/m». */}
                  <label className="flex items-start gap-2 cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={!!editingLiability.noMonthlyPayment}
                      onChange={e => setEditingLiability({
                        ...editingLiability,
                        noMonthlyPayment: e.target.checked,
                        // Al marcarla la cuota se va a cero; al desmarcarla
                        // se recalcula con el plazo que hubiera, para no
                        // dejar una deuda a plazos sin cuota.
                        monthlyPayment: e.target.checked
                          ? 0
                          : calculateFamilyLoanPayment(
                              Number(editingLiability.value) || 0,
                              Number(editingLiability.interestRatePct) || 0,
                              Number(editingLiability.durationMonths) || 1
                            )
                      })}
                      className="w-4 h-4 mt-0.5 rounded border-brand-border bg-brand-bg accent-[color:var(--color-brand-accent)] flex-shrink-0"
                    />
                    <span className={`${themeClasses.textTitle} font-medium leading-snug`}>{t.field_no_monthly_payment}</span>
                  </label>

                  <div className={`grid grid-cols-2 gap-3 items-end pt-1${editingLiability.noMonthlyPayment ? ' opacity-50' : ''}`}>
                    <div>
                      <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-bold font-sans`}>{t.field_family_months}</label>
                      <FormattedNumberInput
                        value={editingLiability.durationMonths ?? 1}
                        min={1}
                        onChange={m => {
                          const total = Number(editingLiability.value) || 0;
                          const rate = Number(editingLiability.interestRatePct) || 0;
                          const currentPayment = Number(editingLiability.monthlyPayment) || 0;
                          setEditingLiability({
                            ...editingLiability,
                            durationMonths: m,
                            monthlyPayment: m > 0 ? calculateFamilyLoanPayment(total, rate, m) : currentPayment
                          });
                        }}
                        disabled={!!editingLiability.noMonthlyPayment}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}${editingLiability.noMonthlyPayment ? ' cursor-not-allowed' : ''}`}
                      />
                    </div>

                    <div>
                      <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-bold font-sans`}>{t.field_family_payment}</label>
                      <FormattedNumberInput
                        value={editingLiability.monthlyPayment ?? 0}
                        min={1}
                        onChange={pay => {
                          const total = Number(editingLiability.value) || 0;
                          const rate = Number(editingLiability.interestRatePct) || 0;
                          setEditingLiability({
                            ...editingLiability,
                            monthlyPayment: pay,
                            durationMonths: calculateFamilyLoanMonths(total, rate, pay)
                          });
                        }}
                        disabled={!!editingLiability.noMonthlyPayment}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}${editingLiability.noMonthlyPayment ? ' cursor-not-allowed' : ''}`}
                      />
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.col_pending_balance}</label>
                      <FormattedNumberInput
                        value={editingLiability.value}
                        onChange={v => setEditingLiability({ ...editingLiability, value: v })}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 font-mono outline-none ${themeClasses.input}`}
                      />
                    </div>
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.field_currency}</label>
                      <select
                        value={editingLiability.currency}
                        onChange={e => setEditingLiability({ ...editingLiability, currency: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      >
                        {ALL_SUPPORTED_CURRENCIES.map(c => (
                          <option key={c.code} value={c.code}>{c.code}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1 items-end">
                    <div>
                      <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-bold font-sans`}>{t.field_interest_rate}</label>
                      <div className="relative flex items-center">
                        <FormattedNumberInput
                          value={editingLiability.interestRatePct}
                          decimals={2}
                          min={0}
                          onChange={v => setEditingLiability({ ...editingLiability, interestRatePct: v })}
                          className={`w-full border rounded-lg p-2.5 pr-7 text-xs font-mono ${themeClasses.input}`}
                        />
                        <span className="absolute right-2.5 text-xs text-slate-600 dark:text-slate-400 font-bold pointer-events-none font-sans">%</span>
                      </div>
                    </div>
                    <div>
                      <label className={`block text-xs ${themeClasses.textMuted} mb-1 leading-tight h-8 flex items-end font-bold font-sans`}>{t.col_monthly_payment}</label>
                      <FormattedNumberInput
                        value={editingLiability.monthlyPayment}
                        onChange={v => setEditingLiability({ ...editingLiability, monthlyPayment: v })}
                        min={0}
                        className={`w-full border rounded-lg p-2.5 text-xs font-mono ${themeClasses.input}`}
                      />
                    </div>
                  </div>
                </>
              )}

              <div className="pt-3 flex gap-2 font-sans">
                {!isNewLiability && (
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm(t.confirm_delete_item.replace('{name}', editingLiability.name || ''))) return;
                      deleteWithUndo('liabilities', liabilities, t.undo_deleted_one.replace('{name}', editingLiability.name || ''));
                      setLiabilities(liabilities.filter(l => l.id !== editingLiability.id));
                      setEditingLiability(null);
                    }}
                    className="bg-rose-100 hover:bg-rose-200 text-rose-950 border border-rose-400 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 dark:text-rose-400 dark:border-rose-500/30 px-3 py-2.5 rounded-lg font-bold"
                  >
                    {t.btn_delete}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setEditingLiability(null)}
                  className={`flex-1 py-2.5 rounded-lg font-bold ${themeClasses.btnSecondary}`}
                >
                  {t.btn_cancel}
                </button>
                <button
                  type="submit"
                  className="flex-1 bg-rose-700 hover:bg-rose-800 text-white py-2.5 rounded-lg font-bold"
                >
                  {t.btn_save}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: QUÉ VA A CAMBIAR AL CARGAR UNA COPIA */}
      {importPreview && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
             onMouseDown={e => { if (e.target === e.currentTarget) setImportPreview(null); }}>
          <div role="dialog" aria-modal="true" data-modal="import" aria-label={t.import_preview_title}
               className={`border rounded-2xl p-5 md:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 ${themeClasses.modalBg}`}>
            <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
              <h3 className={`font-bold text-base ${themeClasses.textTitle}`}>{t.import_preview_title}</h3>
              <button onClick={() => setImportPreview(null)} aria-label={t.btn_close} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle}`}>✕</button>
            </div>

            <p className={`text-xs leading-relaxed ${themeClasses.textMuted}`}>{t.import_preview_desc}</p>

            <div className={`rounded-xl border divide-y ${themeClasses.cardInner} ${themeClasses.tableBorder}`}>
              {(() => {
                const sm = importPreview.summary;
                const rows = [
                  { k: 'assets', label: t.tab_assets, from: `${formatNumber(sm.assets.from, 0)} · ${formatCurrency(sm.assetValue.from)}`, to: `${formatNumber(sm.assets.to, 0)} · ${formatCurrency(sm.assetValue.to)}` },
                  { k: 'liabs', label: t.tab_liabilities, from: `${formatNumber(sm.liabilities.from, 0)} · ${formatCurrency(sm.liabilityValue.from)}`, to: `${formatNumber(sm.liabilities.to, 0)} · ${formatCurrency(sm.liabilityValue.to)}` }
                ];
                if (sm.expenses) rows.push({ k: 'exp', label: t.exp_total_monthly, from: `${formatCurrency(sm.expenses.from)}${t.per_month_short}`, to: `${formatCurrency(sm.expenses.to)}${t.per_month_short}` });
                if (sm.familyMembers) rows.push({ k: 'fam', label: t.family_members, from: String(sm.familyMembers.from), to: String(sm.familyMembers.to) });
                // La base ya no cambia: si el fichero venía en otra divisa,
                // lo que se anuncia es la conversión de sus gastos a euros.
                if (sm.baseCurrency) rows.push({ k: 'cur', label: t.base_currency_label, from: sm.baseCurrency.to, to: sm.baseCurrency.from });

                return rows.map(r => (
                  <div key={r.k} className="p-2.5 flex items-center justify-between gap-3 text-xs">
                    <span className={`${themeClasses.textMuted} font-bold flex-shrink-0`}>{r.label}</span>
                    <span className="font-mono text-right">
                      <span className="text-rose-700 dark:text-rose-400 line-through opacity-70">{r.from}</span>
                      <span className={`${themeClasses.textMuted} mx-1.5`}>→</span>
                      <span className="text-emerald-700 dark:text-emerald-400 font-bold">{r.to}</span>
                    </span>
                  </div>
                ));
              })()}
            </div>

            <p className="text-[11px] p-2.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-400 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 font-semibold">
              {t.import_preview_warning}
            </p>

            {importPreview.next.currencyConversions?.length > 0 && (
              <p className="text-[11px] p-2.5 rounded-lg bg-amber-100 text-amber-950 border border-amber-400 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30 font-semibold">
                {t.currency_retired_notice.replace('{list}', describeConversions(importPreview.next.currencyConversions))}
              </p>
            )}

            <div className="pt-1 flex gap-2">
              <button
                onClick={() => setImportPreview(null)}
                className={`flex-1 py-2.5 rounded-lg font-bold text-xs ${themeClasses.btnSecondary}`}
              >
                {t.btn_cancel}
              </button>
              <button
                onClick={applyImportPreview}
                className="flex-1 bg-brand-emerald hover:bg-emerald-400 text-slate-950 py-2.5 rounded-lg font-bold text-xs"
              >
                {t.btn_import_confirm}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AVISO DE MÓVIL. Mismo contenido y mismo aspecto que en /retiro: las
          clases son las del bloque compartido de index.css, no utilidades de
          Tailwind. La dirección de la herramienta hace de enlace dentro de la
          frase, que lleva {balance} en su lugar. */}
      {showMobileModal && (
        <div className="mobile-modal no-print"
             onClick={e => { if (e.target === e.currentTarget) setShowMobileModal(false); }}>
          <div role="dialog" aria-modal="true" data-modal="mobile" aria-labelledby="mobileModalTitle" className="mobile-modal-card">
            <div className="mobile-modal-head">
              <h3 id="mobileModalTitle" className="mobile-modal-title">{t.mobile_modal_title}</h3>
              <button type="button" className="mobile-modal-x" onClick={() => setShowMobileModal(false)} aria-label={t.btn_close}>✕</button>
            </div>
            <p className="mobile-modal-warning">{t.mobile_modal_warning}</p>
            <div className="mobile-modal-manual">
              <p>
                {t.mobile_modal_manual_lead.split('{balance}').map((trozo, i) => i === 0 ? trozo : (
                  <Fragment key={i}>
                    <a className="mobile-modal-link" href={TOOL_URLS.balance} target="_blank" rel="noopener">{TOOL_URLS.balance.replace(/^https:\/\//, '').replace(/\/$/, '')}</a>{trozo}
                  </Fragment>
                ))}
              </p>
              <a href={MANUAL_URL} target="_blank" rel="sponsored noopener" className="manual-cta">
                <span aria-hidden="true">📖</span><span>{t.mobile_modal_manual_cta}</span><span aria-hidden="true">→</span>
              </a>
            </div>
            <button type="button" className="mobile-modal-ok" onClick={() => setShowMobileModal(false)}>{t.mobile_modal_ok}</button>
          </div>
        </div>
      )}

      {/* MODAL DE FAQ */}
      {showFaqModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
             onMouseDown={e => { if (e.target === e.currentTarget) setShowFaqModal(false); }}>
          <div role="dialog" aria-modal="true" data-modal="faq" aria-label={t.modal_faq_title} className={`border rounded-2xl p-5 md:p-6 max-w-lg w-full max-h-[85vh] overflow-y-auto space-y-4 ${themeClasses.modalBg}`}>
            <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
              <h3 className={`font-bold text-base ${themeClasses.textTitle} flex items-center gap-2`}>
                <span>❓</span> {t.modal_faq_title}
              </h3>
              <button onClick={() => setShowFaqModal(false)} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle} text-lg`}>✕</button>
            </div>

            <div className="space-y-2 text-xs">
             {/* Botón superior de Guía / Ayuda */}
            <button
              onClick={() => {
                setShowFaqModal(false);
                setShowOnboardingModal(true);
              }}
              className="w-full py-2.5 px-3 bg-brand-emerald/10 border border-brand-emerald/30 hover:bg-brand-emerald/20 text-brand-emerald rounded-xl text-xs font-bold transition flex items-center justify-center gap-2 mb-4"
            >
              {t.btn_open_guide}
            </button>
              
              {FAQ_ITEMS.map((item, idx) => {
                const isOpen = expandedFaq === idx;
                return (
                  <div key={idx} className="border rounded-xl transition-all overflow-hidden bg-brand-bg/80 border-brand-border">
                    <button
                      onClick={() => setExpandedFaq(isOpen ? null : idx)}
                      className="w-full p-3 text-left font-bold flex justify-between items-center gap-2"
                    >
                      <span className={themeClasses.textTitle}>{lang === 'es' ? item.q_es : item.q_en}</span>
                      <span className="text-emerald-600 dark:text-emerald-400 font-mono font-bold flex-shrink-0 text-sm">
                        {isOpen ? '▲' : '▼'}
                      </span>
                    </button>
                    {isOpen && (
                      <div className={`p-3 pt-0 text-[11px] leading-relaxed border-t border-slate-200 dark:border-slate-800/60 ${themeClasses.textMuted}`}>
                        {lang === 'es' ? item.a_es : item.a_en}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* El manual, lo último y bien visible: es el siguiente paso para
                quien ha llegado hasta aquí buscando ayuda. Mismo botón que en
                /retiro (index.css). */}
            <a href={MANUAL_URL} target="_blank" rel="sponsored noopener" className="manual-cta">
              <span aria-hidden="true">📖</span><span>{t.faq_manual_cta}</span><span aria-hidden="true">→</span>
            </a>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowFaqModal(false)}
                className="px-5 py-2 bg-brand-emerald hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition"
              >
                {t.btn_close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DE COMPARTIR */}
      {showShareModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
             onMouseDown={e => { if (e.target === e.currentTarget) setShowShareModal(false); }}>
          <div role="dialog" aria-modal="true" data-modal="share" aria-label={t.modal_share_title} className={`border rounded-2xl p-5 md:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 ${themeClasses.modalBg}`}>
            <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
              <h3 className={`font-bold text-base ${themeClasses.textTitle} flex items-center gap-2`}>
                <span>🔗</span> {t.modal_share_title}
              </h3>
              <button onClick={() => setShowShareModal(false)} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle}`}>✕</button>
            </div>

            <p className={`text-xs leading-relaxed ${themeClasses.textMuted}`}>
              {t.modal_share_desc}
            </p>

<div className="grid grid-cols-1 gap-2.5 pt-2">
              {/* WhatsApp */}
              <a
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-800 dark:text-emerald-300 font-bold text-xs transition"
              >
                <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M.057 24l1.687-6.163c-1.041-1.804-1.588-3.849-1.587-5.946.003-6.556 5.338-11.891 11.893-11.891 3.181.001 6.167 1.24 8.413 3.488 2.245 2.248 3.481 5.236 3.48 8.414-.003 6.557-5.338 11.892-11.893 11.892-1.99-.001-3.951-.5-5.688-1.448l-6.305 1.654zm6.597-3.807c1.676.995 3.276 1.591 5.392 1.592 5.448 0 9.886-4.434 9.889-9.885.002-5.462-4.415-9.89-9.881-9.892-5.452 0-9.887 4.434-9.889 9.884-.001 2.225.651 3.891 1.746 5.634l-.999 3.648 3.742-.981z"/>
                </svg>
                <span>WhatsApp</span>
              </a>

              {/* X (Twitter) */}
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-slate-700 bg-slate-800/40 hover:bg-slate-800 text-slate-200 font-bold text-xs transition"
              >
                <svg className="w-4 h-4 fill-current flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                </svg>
                <span>X (Twitter)</span>
              </a>

              {/* Facebook */}
              <a
                href={`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}&quote=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-blue-500/30 bg-blue-500/10 hover:bg-blue-500/20 text-blue-700 dark:text-blue-300 font-bold text-xs transition"
              >
                <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                </svg>
                <span>Facebook</span>
              </a>

              {/* Instagram */}
              <a
                href="https://instagram.com/direct/inbox/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCopyShareUrl}
                className="flex items-center justify-between p-3 rounded-xl border border-pink-500/30 bg-pink-500/10 hover:bg-pink-500/20 text-pink-700 dark:text-pink-300 font-bold text-xs transition"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zm0-2.163c-3.259 0-3.667.014-4.947.072-4.358.2-6.78 2.618-6.98 6.98-.059 1.281-.073 1.689-.073 4.948 0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98 1.281.058 1.689.072 4.948.072 3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98-1.281-.059-1.69-.073-4.949-.073zm0 5.838c-3.403 0-6.162 2.759-6.162 6.162s2.759 6.163 6.162 6.163 6.162-2.759 6.162-6.163c0-3.403-2.759-6.162-6.162-6.162zm0 10.162c-2.209 0-4-1.79-4-4 0-2.209 1.791-4 4-4s4 1.791 4 4c0 2.21-1.791 4-4 4zm6.406-11.845c-.796 0-1.441.645-1.441 1.44s.645 1.44 1.441 1.44c.795 0 1.439-.645 1.439-1.44s-.644-1.44-1.439-1.44z"/>
                  </svg>
                  <span>Instagram</span>
                </div>
                <span className="text-[10px] opacity-75 font-normal">({t.share_copies_link})</span>
              </a>

              {/* LinkedIn */}
              <a
                href={`https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-sky-500/30 bg-sky-500/10 hover:bg-sky-500/20 text-sky-700 dark:text-sky-300 font-bold text-xs transition"
              >
                <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M19 0h-14c-2.761 0-5 2.239-5 5v14c0 2.761 2.239 5 5 5h14c2.762 0 5-2.239 5-5v-14c0-2.761-2.238-5-5-5zm-11 19h-3v-11h3v11zm-1.5-12.268c-.966 0-1.75-.79-1.75-1.764s.784-1.764 1.75-1.764 1.75.79 1.75 1.764-.783 1.764-1.75 1.764zm13.5 12.268h-3v-5.604c0-3.368-4-3.113-4 0v5.604h-3v-11h3v1.765c1.396-2.586 7-2.777 7 2.476v6.759z"/>
                </svg>
                <span>LinkedIn</span>
              </a>

              {/* Telegram */}
              <a
                href={`https://t.me/share/url?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 p-3 rounded-xl border border-sky-400/30 bg-sky-400/10 hover:bg-sky-400/20 text-sky-600 dark:text-sky-300 font-bold text-xs transition"
              >
                <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 24 24">
                  <path d="M12 0c-6.627 0-12 5.373-12 12s5.373 12 12 12 12-5.373 12-12-5.373-12-12-12zm5.894 8.221l-1.97 9.28c-.145.658-.537.818-1.084.508l-3-2.21-1.446 1.394c-.16.16-.295.295-.605.295l.213-3.053 5.56-5.023c.242-.213-.054-.333-.373-.121l-6.871 4.326-2.962-.924c-.643-.204-.657-.643.136-.953l11.57-4.461c.537-.194 1.006.131.832.942z"/>
                </svg>
                <span>Telegram</span>
              </a>

              {/* TikTok */}
              <a
                href="https://www.tiktok.com/"
                target="_blank"
                rel="noopener noreferrer"
                onClick={handleCopyShareUrl}
                className="flex items-center justify-between p-3 rounded-xl border border-slate-600 bg-slate-500/10 hover:bg-slate-500/20 text-slate-800 dark:text-slate-200 font-bold text-xs transition"
              >
                <div className="flex items-center gap-3">
                  <svg className="w-5 h-5 fill-current flex-shrink-0" viewBox="0 0 24 24">
                    <path d="M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z"/>
                  </svg>
                  <span>TikTok</span>
                </div>
                <span className="text-[10px] opacity-75 font-normal">({t.share_copies_link})</span>
              </a>
            </div>

            <div className="pt-3 border-t border-slate-200 dark:border-slate-800 space-y-2">
              <div className="flex gap-2">
                <input
                  type="text"
                  readOnly
                  value={shareUrl}
                  className={`flex-1 p-2 text-xs font-mono rounded-lg border outline-none truncate ${themeClasses.input}`}
                />
                <button
                  onClick={handleCopyShareUrl}
                  className="bg-brand-emerald hover:bg-emerald-400 text-slate-950 font-bold px-3 py-2 rounded-lg text-xs transition flex-shrink-0"
                >
                  📋 {t.btn_copy_short}
                </button>
              </div>
              {copiedNotification && (
                <p className="text-xs text-emerald-600 dark:text-emerald-400 font-bold text-center">
                  ✅ {t.copied_text}
                </p>
              )}
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={() => setShowShareModal(false)}
                className="bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-950 dark:text-slate-200 px-4 py-2 rounded-lg font-bold text-xs"
              >
                {t.btn_close}
              </button>
            </div>
          </div>
        </div>
      )}

        {/* MODAL DE BIENVENIDA / ONBOARDING */}
      {showOnboardingModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
             onMouseDown={e => { if (e.target === e.currentTarget) handleCloseOnboarding(); }}>
          <div role="dialog" aria-modal="true" data-modal="onboarding" aria-label={t.onboarding_title} className={`border rounded-2xl p-5 md:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 shadow-2xl ${themeClasses.modalBg}`}>
            <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
              <h3 className={`font-bold text-base ${themeClasses.textTitle} flex items-center gap-2`}>
                <span>🚀</span> {t.onboarding_title}
              </h3>
              <button onClick={handleCloseOnboarding} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle}`}>✕</button>
            </div>

            {/* Tres pasos, los mismos tres bloques del manual: la idea, meter los
                datos y leer los resultados. */}
             <div className="p-4 rounded-xl border border-brand-border bg-brand-bg/80 space-y-3 text-xs">
              {[
                [t.onboarding_s1_title, t.onboarding_s1_body],
                [t.onboarding_s2_title, t.onboarding_s2_body],
                [t.onboarding_s3_title, t.onboarding_s3_body]
              ].map(([titulo, cuerpo]) => (
                <div key={titulo} className="space-y-1">
                  <p className="text-brand-accent font-bold">{titulo}</p>
                  <p className="leading-relaxed text-brand-text">{cuerpo}</p>
                </div>
              ))}

              <div className="pt-2 mt-2 border-t border-slate-200 dark:border-slate-800 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                {t.onboarding_privacy_note}
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                onClick={handleCloseOnboarding}
                className="w-full py-2.5 rounded-lg bg-brand-emerald hover:bg-emerald-400 text-slate-950 font-bold transition text-xs shadow-md"
              >
                {t.btn_start_onboarding}
              </button>
            </div>
          </div>
        </div>
      )}
        
     {/* MODAL DE FEEDBACK */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4 z-50 font-sans"
             onMouseDown={e => { if (e.target === e.currentTarget) setShowFeedbackModal(false); }}>
          <div role="dialog" aria-modal="true" data-modal="feedback" aria-label={t.modal_feedback_title} className={`border rounded-2xl p-5 md:p-6 max-w-md w-full max-h-[90vh] overflow-y-auto space-y-4 ${themeClasses.modalBg}`}>
            <div className={`flex justify-between items-center border-b ${themeClasses.headerBorder} pb-3`}>
              <h3 className={`font-bold text-base ${themeClasses.textTitle}`}>{t.modal_feedback_title}</h3>
              <button onClick={() => setShowFeedbackModal(false)} className={`${themeClasses.textMuted} hover:${themeClasses.textTitle}`}>✕</button>
            </div>

{feedbackSent ? (
              <div className={`p-4 rounded-xl text-xs text-center space-y-3 ${isDark ? 'bg-emerald-500/10 border border-emerald-500/30 text-emerald-300' : 'bg-emerald-100 border border-emerald-300 text-emerald-950'}`}>
                <p className="font-bold">{t.feedback_sent_ok}</p>
                <button
                  onClick={() => setShowFeedbackModal(false)}
                  className="px-5 py-2 bg-brand-emerald hover:bg-emerald-400 text-slate-950 font-bold rounded-lg text-xs transition"
                >
                  {t.btn_close}
                </button>
              </div>
            ) : (
              (() => {
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                const emailValue = (feedbackData.email || '').trim();
                const isEmailFilled = emailValue.length > 0;
                const isEmailValid = !isEmailFilled || emailRegex.test(emailValue);
                const isNameFilled = (feedbackData.name || '').trim().length > 0;
                const isMessageFilled = (feedbackData.message || '').trim().length > 0;
                const isFormValid = isNameFilled && isMessageFilled && isEmailValid;

                return (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      if (!isFormValid) return;
                      setFeedbackError(null);

                      try {
                        if (feedbackData.gotcha) {
                          setFeedbackSent(true);
                          return;
                        }

                        const response = await fetch("https://formspree.io/f/myegbrbn", {
                          method: "POST",
                          headers: {
                            "Content-Type": "application/json",
                            "Accept": "application/json"
                          },
                          body: JSON.stringify({
                            name: feedbackData.name.trim(),
                            email: emailValue || "No facilitado",
                            type: feedbackData.type,
                            message: feedbackData.message.trim(),
                            _gotcha: feedbackData.gotcha,
                            baseCurrency: baseCurrency,
                            lang: lang
                          })
                        });

                        if (response.ok) {
                          setFeedbackSent(true);
                          setFeedbackData({ name: '', email: '', type: 'idea', message: '', gotcha: '' });
                        } else {
                          setFeedbackError(t.feedback_send_error);
                        }
                    } catch (err) {
                      // Antes iba a dataFeedbackMsg, que solo se pinta en la
                      // pestaña de Parámetros: invisible desde aquí.
                      setFeedbackError(t.feedback_network_error);
                    }
                    }}
                    className="space-y-3 text-xs"
                  >
          {feedbackError && (
                      <div className="p-3 rounded-xl text-xs font-bold bg-rose-100 text-rose-950 border border-rose-400 dark:bg-rose-500/10 dark:text-rose-300 dark:border-rose-500/30" role="alert">
                        {feedbackError}
                      </div>
                    )}

          {/* Honeypot field for bot protection */}
            <input
              type="text"
              name="_gotcha"
              value={feedbackData.gotcha}
              onChange={e => setFeedbackData({ ...feedbackData, gotcha: e.target.value })}
              style={{ display: 'none' }}
              tabIndex="-1"
              autoComplete="off"
              data-lpignore="true"
              aria-hidden="true"
/>

                    {/* Nombre (Obligatorio) */}
                    <div>
                      <label className={`block mb-1 font-bold ${themeClasses.textTitle}`}>
                        {t.feedback_name} <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        placeholder={t.feedback_name_ph}
                        value={feedbackData.name}
                        onChange={e => setFeedbackData({ ...feedbackData, name: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      />
                    </div>

                    {/* Email (Opcional con validación) */}
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>
                        {t.feedback_email}
                      </label>
                      <input
                        type="email"
                        placeholder={t.feedback_email_ph}
                        value={feedbackData.email}
                        onChange={e => setFeedbackData({ ...feedbackData, email: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none transition ${
                          isEmailFilled && !isEmailValid 
                            ? 'border-rose-500 bg-rose-500/5 focus:border-rose-500' 
                            : themeClasses.input
                        }`}
                      />
                      {isEmailFilled && !isEmailValid && (
                        <p className="text-[11px] text-rose-500 dark:text-rose-400 font-semibold mt-1">
                          ⚠️ {t.feedback_email_invalid}
                        </p>
                      )}
                    </div>

                    {/* Tipo de mensaje */}
                    <div>
                      <label className={`block mb-1 ${themeClasses.textMuted}`}>{t.feedback_type}</label>
                      <select
                        value={feedbackData.type}
                        onChange={e => setFeedbackData({ ...feedbackData, type: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      >
                        <option value="idea">{t.feedback_type_idea}</option>
                        <option value="bug">{t.feedback_type_bug}</option>
                        <option value="other">{t.feedback_type_other}</option>
                      </select>
                    </div>

                    {/* Mensaje (Obligatorio) */}
                    <div>
                      <label className={`block mb-1 font-bold ${themeClasses.textTitle}`}>
                        {t.feedback_msg} <span className="text-rose-500">*</span>
                      </label>
                      <textarea
                        required
                        rows="4"
                        value={feedbackData.message}
                        onChange={e => setFeedbackData({ ...feedbackData, message: e.target.value })}
                        className={`w-full border rounded-lg p-2.5 outline-none ${themeClasses.input}`}
                      ></textarea>
                    </div>

                    {/* Botones */}
                    <div className="pt-2 flex gap-2 font-sans">
                      <button
                        type="button"
                        onClick={() => setShowFeedbackModal(false)}
                        className={`w-1/2 py-2.5 rounded-lg font-bold ${themeClasses.btnSecondary}`}
                      >
                        {t.btn_cancel}
                      </button>
                      <button
                        type="submit"
                        disabled={!isFormValid}
                        className={`w-1/2 py-2.5 rounded-lg font-bold transition ${
                          isFormValid
                            ? 'bg-brand-emerald hover:bg-emerald-400 text-slate-950 cursor-pointer shadow-md'
                            : 'bg-slate-200 dark:bg-slate-800 text-slate-500 cursor-not-allowed opacity-60'
                        }`}
                      >
                        {t.btn_send_feedback}
                      </button>
                    </div>
                  </form>
                );
              })()
            )}
          </div>
        </div>
      )}
    </div>
  </TooltipProvider>

      {/* El selector de archivo vive aquí y no dentro de la pestaña de
          Variables: el botón de cargar de la cabecera está siempre visible,
          y con el input montado solo en esa pestaña no hacía nada desde
          ninguna otra. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".txt,.json"
        onChange={handleImportData}
        className="hidden"
      />

      {/* Aviso de deshacer. No lleva role="dialog" a propósito: la trampa
          de foco busca diálogos y este no lo es, solo informa. `status`
          con aria-live lo anuncia sin robar el foco a nadie. */}
      {pendingUndo && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-x-0 bottom-0 z-50 p-3 pointer-events-none flex justify-center"
        >
          <div className={`pointer-events-auto max-w-md w-full flex items-center gap-3 rounded-xl border px-4 py-3 shadow-2xl text-xs font-sans ${themeClasses.modalBg}`}>
            <span className={`flex-1 ${themeClasses.textTitle}`}>{pendingUndo.message}</span>
            <button
              type="button"
              onClick={undoDelete}
              className="flex-shrink-0 px-3 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 transition"
            >
              {t.undo_action}
            </button>
            <button
              type="button"
              onClick={() => setPendingUndo(null)}
              aria-label={t.undo_dismiss}
              className={`flex-shrink-0 px-2 py-1.5 rounded-lg font-bold ${themeClasses.textMuted} hover:opacity-70`}
            >
              ✕
            </button>
          </div>
        </div>
      )}

    </LocaleContext.Provider>
  );
}
export default App;
