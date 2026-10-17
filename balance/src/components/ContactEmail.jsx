import { useState, useRef, useEffect } from 'react';

// La dirección de contacto no aparece en el marcado: se ensambla en tiempo de
// ejecución a partir de trozos, para que los rastreadores que buscan
// "algo@algo" en el HTML no la encuentren. Es lo mismo que hace Retiro.
function contactEmailAddress() {
  const user = ['bal', 'an', 'ce'].join('');
  const host = ['paco', 'lucena'].join('') + String.fromCharCode(46) + 'com';
  return user + String.fromCharCode(64) + host;
}

// Al pulsar se copia al portapapeles en vez de abrir un cliente de correo: en
// un móvil sin cuenta configurada un mailto no lleva a ninguna parte.
export function ContactEmailButton({ label = 'Contacto', copiedLabel = 'copiado', className = '' }) {
  const [copiado, setCopiado] = useState('');
  const temporizador = useRef(null);

  // Sin esto, volver a montar el componente con el aviso en marcha dejaba un
  // setTimeout apuntando a un estado que ya no existe.
  useEffect(() => () => clearTimeout(temporizador.current), []);

  const avisar = (direccion) => {
    setCopiado(direccion);
    clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => setCopiado(''), 2500);
  };

  const copiar = () => {
    const direccion = contactEmailAddress();
    // El portapapeles falla en contextos no seguros y si el usuario deniega el
    // permiso; en ese caso se enseña la dirección para copiarla a mano, que es
    // mejor que no hacer nada.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(direccion)
        .then(() => avisar(direccion))
        .catch(() => window.prompt('Copia la dirección:', direccion));
    } else {
      window.prompt('Copia la dirección:', direccion);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={copiar}
        title={label}
        className={className || 'font-bold underline text-slate-900 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400 transition cursor-pointer'}
      >
        {label}
      </button>
      <span
        aria-live="polite"
        className={`ml-1.5 text-emerald-700 dark:text-emerald-400 font-semibold transition-opacity duration-300 ${copiado ? 'opacity-100' : 'opacity-0'}`}
      >
        {copiado ? `✓ ${copiado} ${copiedLabel}` : ''}
      </span>
    </>
  );
}
