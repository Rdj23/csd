/**
 * One KPI tile on the ongoing board (Critical / Warning / Healthy).
 *
 * WAS DEFINED INSIDE App.jsx. A component declared in another component's body
 * gets a brand-new function identity on every parent render, so React treats it
 * as a different component type and remounts the whole subtree each time.
 * KPICard holds no state, so that was invisible apart from the wasted work —
 * but it is still the reason this belongs at module scope.
 *
 * It used to close over currentFilters and handleKPIFilter directly; those are
 * now the `currentFilters` and `onFilter` props, which is what makes it a
 * component you can read (and reuse) without App.jsx around it.
 */

const KPICard = ({
  count,
  label,
  borderClass,
  icon: Icon,
  filterVal,
  textClassLight,
  textClassDark,
  currentFilters,
  onFilter,
}) => {
  const isDisabled = count === 0;
  const healthFilter = currentFilters.health || [];
  const isActive = healthFilter.includes(filterVal);
  const isInactive = healthFilter.length > 0 && !isActive;

  return (
  <button
    onClick={() => !isDisabled && onFilter(filterVal)}
    disabled={isDisabled}
    className={`relative group text-left w-full rounded-xl border overflow-hidden
      transition-all duration-200
      ${isDisabled
        ? "opacity-60 cursor-not-allowed bg-slate-50 dark:bg-slate-800/50 border-slate-200 dark:border-slate-700"
        : isInactive
        ? "opacity-70 hover:-translate-y-0.5 cursor-pointer bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800"
        : "hover:-translate-y-0.5 cursor-pointer"
      }
      ${!isDisabled && !isInactive && (filterVal === "Healthy"
        ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-emerald-200 dark:hover:border-emerald-800/60"
        : filterVal === "Needs Attention"
        ? "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-amber-200 dark:hover:border-amber-800/60"
        : "bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 hover:border-rose-200 dark:hover:border-rose-800/60")
      }
      ${isActive && (filterVal === "Healthy"
        ? "ring-2 ring-emerald-400/50 dark:ring-emerald-500/40 border-emerald-300 dark:border-emerald-700"
        : filterVal === "Needs Attention"
        ? "ring-2 ring-amber-400/50 dark:ring-amber-500/40 border-amber-300 dark:border-amber-700"
        : "ring-2 ring-rose-400/50 dark:ring-rose-500/40 border-rose-300 dark:border-rose-700")
      }`}
    style={{ boxShadow: isDisabled ? '0 1px 2px rgba(0,0,0,0.05)' : 'var(--shadow-card)' }}
    title={isDisabled ? "No tickets in this category" : isInactive ? `Click to filter by ${label}` : undefined}
  >
    {/* Left accent bar */}
    <div className={`absolute left-0 top-0 bottom-0 w-1.5 rounded-l-xl ${
      borderClass.replace('border-l-4 border-l-', 'bg-')
    } ${isDisabled ? "opacity-20" : isInactive ? "opacity-40" : ""}`} />

    <div className="pl-5 pr-4 py-4 flex items-center justify-between">
      <div className="flex-1">
        <p className={`text-[10px] font-semibold uppercase tracking-widest mb-2 ${
          isDisabled
            ? "text-slate-400 dark:text-slate-500"
            : isInactive
            ? "text-slate-400 dark:text-slate-500"
            : "text-slate-500 dark:text-slate-400"
        }`}>
          {label}
        </p>
        <p className={`text-4xl font-bold tracking-tight leading-none transition-colors duration-200 ${
          isDisabled
            ? "text-slate-400 dark:text-slate-500"
            : isInactive
            ? "text-slate-400 dark:text-slate-500"
            : `${textClassLight} ${textClassDark}`
        }`}>
          {count}
        </p>
      </div>
      <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ml-2
        transition-all duration-200 ${!isDisabled && "group-hover:scale-110"}
        ${isDisabled
          ? "bg-slate-200 dark:bg-slate-700"
          : isInactive
          ? "bg-slate-100 dark:bg-slate-800"
          : filterVal === "Healthy" ? "bg-emerald-100 dark:bg-emerald-900/30"
          : filterVal === "Needs Attention" ? "bg-amber-100 dark:bg-amber-900/30"
          : "bg-rose-100 dark:bg-rose-900/30"}`}
      >
        <Icon className={`w-5 h-5 ${
          isDisabled
            ? "text-slate-500 dark:text-slate-400 opacity-60"
            : isInactive
            ? "text-slate-400 dark:text-slate-500 opacity-60"
            : `${textClassLight} ${textClassDark} opacity-80`
        }`} />
      </div>
    </div>
  </button>
  );
};

export default KPICard;
