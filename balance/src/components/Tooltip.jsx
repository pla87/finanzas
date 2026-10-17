// Globo de ayuda compartido por toda la aplicación. Vive en un contexto porque
// solo debe haber uno abierto a la vez, y porque en un móvil no hay
// `mouseleave` que lo cierre: hace falta escuchar el siguiente toque.
import { useState, useEffect, useRef, createContext, useContext } from 'react';

// --- CONTEXTO GLOBAL DE TOOLTIP ---
const TooltipContext = createContext(null);

export function TooltipProvider({ children }) {
  const [tooltip, setTooltip] = useState({ visible: false, text: '', x: 0, y: 0 });

  const openForRef = useRef(null);

  const showTooltip = (text, targetEl) => {
    if (!targetEl || !text) return;
    openForRef.current = targetEl;
    const rect = targetEl.getBoundingClientRect();
  const margin = Math.min(140, window.innerWidth / 2 - 10);
  let x = Math.max(margin, Math.min(window.innerWidth - margin, rect.left + rect.width / 2));
  let y = rect.top - 8;

    if (y < 40) {
      y = rect.bottom + 8;
    }

    setTooltip({ visible: true, text, x, y, isBelow: rect.top < 40 });
  };

  const hideTooltip = () => {
    openForRef.current = null;
    setTooltip(prev => ({ ...prev, visible: false }));
  };

  // En un móvil no hay mouseleave: sin esto el globo se quedaba abierto
  // hasta que se tocaba otro.
  useEffect(() => {
    if (!tooltip.visible) return;
    const dismiss = () => hideTooltip();
    document.addEventListener('pointerdown', dismiss);
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('pointerdown', dismiss);
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
    };
  }, [tooltip.visible]);

  return (
    <TooltipContext.Provider value={{ showTooltip, hideTooltip, get isOpenFor() { return openForRef.current; } }}>
      {children}
      {tooltip.visible && (
        <div
          style={{
            position: 'fixed',
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: tooltip.isBelow ? 'translate(-50%, 0)' : 'translate(-50%, -100%)',
            zIndex: 99999
          }}
          className="pointer-events-none w-max max-w-[280px] xs:max-w-xs px-3 py-2 bg-slate-950 text-slate-100 border border-slate-700 text-xs font-normal rounded-none shadow-2xl text-center leading-snug whitespace-normal font-sans"
        >
          {tooltip.text}
        </div>
      )}
    </TooltipContext.Provider>
  );
}

export function Tooltip({ text, children, className = '' }) {
  const context = useContext(TooltipContext);
  if (!text) return <span>{children}</span>;
  if (!context) return <span title={text} className={className}>{children}</span>;

  const { showTooltip, hideTooltip } = context;

  // Sin `title`: duplicaba el globo del navegador sobre el nuestro.
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={text}
      className={`inline-flex items-center gap-0.5 cursor-help whitespace-nowrap ${className}`}
      onMouseEnter={(e) => showTooltip && showTooltip(text, e.currentTarget)}
      onMouseLeave={() => hideTooltip && hideTooltip()}
      onFocus={(e) => showTooltip && showTooltip(text, e.currentTarget)}
      onBlur={() => hideTooltip && hideTooltip()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') hideTooltip && hideTooltip();
      }}
      onPointerDown={(e) => {
        // El manejador global cierra cualquier globo abierto en este mismo
        // gesto; detenerlo aquí es lo que hace que el toque alterne.
        e.stopPropagation();
        const wasOpen = context.isOpenFor === e.currentTarget;
        hideTooltip();
        if (!wasOpen && showTooltip) showTooltip(text, e.currentTarget);
      }}
    >
      {children}
    </span>
  );
}
