// --- COMPONENTE CABECERA PESTAÑA ---
  export function TabHeader({ icon, title, description, isDark, actionButton }) {
  // Los botones se colocan debajo en pantallas estrechas. Compartiendo fila
  // con el texto lo dejaban en una columna de una palabra por línea.
  return (
    <div className="mb-5 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
      <div className="flex-1 min-w-0">
        <h2 className={`text-xl font-bold flex items-center gap-2 ${isDark ? 'text-white' : 'text-slate-950'}`}>
          <span className="text-xl flex-shrink-0">{icon}</span>
          <span className="truncate">{title}</span>
        </h2>
        <p className={`text-xs mt-0.5 font-medium leading-tight ${isDark ? 'text-slate-400' : 'text-slate-600'}`}>{description}</p>
      </div>
      {actionButton && (
        <div className="flex-shrink-0 sm:pt-0.5">
          {actionButton}
        </div>
      )}
    </div>
  );
}
