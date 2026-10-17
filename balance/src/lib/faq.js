// Preguntas frecuentes. Van como datos con `_es` y `_en` en lugar de en la
// tabla de traducciones porque son párrafos largos y allí la harían ilegible.


export const FAQ_ITEMS = [
  {
    q_es: '¿Para qué sirve este Balance personal?',
    a_es: 'Sirve para tener una radiografía patrimonial real y holística que va más allá del saldo en cuenta corriente. Te permite auditar tu apalancamiento neto, medir la rentabilidad real de cada activo (efectivo, uso y apreciación), simular tu colchón de supervivencia y trazar cuantitativamente tu progreso hacia la independencia financiera (FIRE).',
    q_en: 'What is this Personal Balance Sheet for?',
    a_en: 'It provides a comprehensive, realistic financial snapshot that goes far beyond checking account balances. It helps you audit net leverage, evaluate genuine multi-dimensional asset yields (cashflow, utility, and capital appreciation), measure your survival runway, and quantitatively track your journey to financial freedom (FIRE).'
  },
  {
    q_es: '¿No sería más cómodo conectar mis cuentas bancarias?',
    a_es: 'No, porque introducir uno a uno tus activos y deudas te obliga a pensar. La fricción consciente es deliberada: te conecta con el coste de tus pasivos, el destino de tus inversiones y la estructura de tus gastos, fomentando una toma de decisiones reflexiva que la sincronización automática pasiva suele diluir.',
    q_en: 'Wouldn’t it be more convenient to connect my bank accounts via API?',
    a_en: 'No, because entering each asset and liability manually forces you to actively reflect. This intentional friction connects you directly with your borrowing costs, portfolio allocation, and expense drivers—fostering disciplined decision-making that passive auto-sync apps tend to diminish.'
  },
  {
    q_es: '¿Mi información está segura?',
    a_es: 'Sí, absolutamente. Todos los cálculos ocurren en tu dispositivo y tu información no se envía a ningún servidor ni base de datos externa. Tus datos permanecen exclusivamente en el almacenamiento local de tu propio navegador (LocalStorage). La web solo cuenta visitas anónimas con Cloudflare Web Analytics, que no usa cookies. El formulario de sugerencias envía solo lo que tú escribes.',
    q_en: 'Is my financial data secure?',
    a_en: 'Yes, 100%. All formulas and simulations run entirely within your local browser. No financial information is transmitted to external servers or cloud databases; your entries remain strictly private in your local browser storage. The site only counts anonymous visits with Cloudflare Web Analytics, which uses no cookies. The feedback form sends only what you type.'
  },
  {
    q_es: '¿Por qué medir la rentabilidad en Efectivo, Uso y Capital por separado?',
    a_es: 'Porque cada tipo de rentabilidad cumple una función distinta: el Efectivo (cashflow pasivo) paga facturas corrientes, el Uso (ahorro imputado por vivir en casa propia o usar tu coche) reduce tu gasto de vida, y el Capital (revalorización frente a la inflación) preserva y expande tu riqueza a largo plazo.',
    q_en: 'Why break down returns into Cashflow, Imputed Use, and Capital Appreciation?',
    a_en: 'Because each return stream serves a distinct economic purpose: Cashflow covers recurring lifestyle costs, Imputed Use (e.g., rent avoided by owning your home) lowers ongoing living expenses, and Capital Appreciation protects and expands multi-generational wealth against inflation.'
  },
  {
    q_es: '¿Qué busca realmente la metodología de niveles FIRE en esta herramienta?',
    a_es: 'Busca una transición progresiva y sin autoengaños: desde la resiliencia básica (colchón de emergencia de 6 meses y patrimonio positivo) hasta la autosuficiencia operativa de los activos, la libertad básica y la abundancia patrimonial duradera.',
    q_en: 'What is the true philosophy behind the FIRE milestone framework here?',
    a_en: 'It establishes a rigorous, uncompromised path to resilience: progressing from immediate safety (a 6-month liquid buffer and positive non-primary net worth) through asset debt self-sufficiency, lean freedom, and multi-decade wealth abundance.'
  }
];


// Color por dimensión de la auditoría. Solo presentación: el motor no sabe
// nada de esto.
export const AUDIT_DIMENSION_STYLE = {
  solvency:        { accent: 'text-emerald-700 dark:text-emerald-400', bar: 'bg-emerald-500', badge: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/30' },
  leverage:        { accent: 'text-purple-700 dark:text-purple-400',   bar: 'bg-purple-500',  badge: 'bg-purple-500/10 text-purple-800 dark:text-purple-400 border-purple-500/30' },
  diversification: { accent: 'text-amber-700 dark:text-amber-400',     bar: 'bg-amber-500',   badge: 'bg-amber-500/10 text-amber-800 dark:text-amber-400 border-amber-500/30' },
  efficiency:      { accent: 'text-teal-800 dark:text-teal-300',       bar: 'bg-teal-500',    badge: 'bg-teal-500/10 text-teal-800 dark:text-teal-400 border-teal-500/30' },
  runway:          { accent: 'text-sky-700 dark:text-sky-400',         bar: 'bg-sky-500',     badge: 'bg-sky-500/10 text-sky-800 dark:text-sky-400 border-sky-500/30' },
  coverage:        { accent: 'text-emerald-800 dark:text-emerald-300', bar: 'bg-emerald-600', badge: 'bg-emerald-500/10 text-emerald-800 dark:text-emerald-400 border-emerald-500/30' }
};


