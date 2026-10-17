// Campo numérico que enseña el número con el formato del idioma y devuelve un
// número de verdad. El idioma llega por contexto y no por prop para que ningún
// punto de uso pueda olvidarse de pasarlo.
import { useState, useEffect, createContext, useContext } from 'react';
import { parseLocaleNumber } from '../lib/finance.js';

// --- IDIOMA PARA LA ENTRADA DE NÚMEROS ---
// El componente vive fuera de App, así que el idioma le llega por contexto
// en lugar de por prop: así ningún punto de uso puede olvidarse de pasarlo.
export const LocaleContext = createContext('es-ES');

// --- COMPONENTE INPUT FORMATEADO ---
  export function FormattedNumberInput({
    value,
    onChange,
    className = '',
    placeholder = '',
    decimals = 0,
    min,
    max,
    disabled = false
  }) {
    const locale = useContext(LocaleContext);

    const formatVal = (v) => {
      if (v === '' || v === null || v === undefined) return '';
      const n = Number(v);
      if (isNaN(n)) return '';
      return new Intl.NumberFormat(locale, {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals,
        useGrouping: true
      }).format(n);
    };

    const [displayVal, setDisplayVal] = useState(() => (value === 0 ? '0' : formatVal(value)));
    const [isFocused, setIsFocused] = useState(false);

    useEffect(() => {
      if (!isFocused) {
        setDisplayVal(formatVal(value));
      }
    }, [value, isFocused, locale]);

    const handleChange = (e) => {
      const text = e.target.value;
      setDisplayVal(text);

      // Un texto que todavía no es un número (vacío, "-", "1,") deja el
      // valor anterior intacto: vaciar un campo es un estado de edición,
      // no una forma de escribir cero.
      const num = parseLocaleNumber(text, locale, decimals);
      if (num === null) return;
      if (min !== undefined && num < min) return;
      if (max !== undefined && num > max) return;
      onChange(num);
    };

    const handleBlur = () => {
      setIsFocused(false);
      setDisplayVal(formatVal(value));
    };

    const handleFocus = (e) => {
      setIsFocused(true);
      e.target.select();
    };

    return (
      <input
        type="text"
        inputMode={decimals > 0 ? "decimal" : "numeric"}
        value={isFocused ? displayVal : formatVal(value)}
        onChange={handleChange}
        onFocus={handleFocus}
        onBlur={handleBlur}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
      />
    );
  }
