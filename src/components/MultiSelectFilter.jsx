import React, { useState, useMemo, useRef, useEffect } from "react";
import { ChevronDown, Search } from "lucide-react";

const MultiSelectFilter = ({ icon: Icon, label, options, selected, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const filteredOptions = useMemo(() => {
    return options
      .filter(opt => opt && opt !== "Unknown" && opt.trim() !== "" && opt !== "[not provided]") 
      .filter(opt => opt.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const aSelected = selected.includes(a);
        const bSelected = selected.includes(b);
        if (aSelected && !bSelected) return -1;
        if (!aSelected && bSelected) return 1;
        return a.localeCompare(b);
      });
  }, [options, query, selected]);

  const toggleOption = (opt) => {
    const newSelected = selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt];
    onChange(newSelected);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all whitespace-nowrap shadow-sm ${selected.length > 0 ? 'bg-white border-indigo-400 bg-indigo-50/60 dark:bg-indigo-900/30 text-indigo-600 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-200' : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'}`}
      >
        <Icon className={`w-3.5 h-3.5 ${selected.length > 0 ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
        <span className="max-w-[100px] truncate">
          {selected.length === 0 ? label : `${selected.length} ${label}`}
        </span>
        <ChevronDown className={`w-3 h-3 opacity-50 ${selected.length > 0 ? 'text-indigo-600 dark:text-indigo-400' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden flex flex-col ring-1 ring-black/5">
          <div className="p-2 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900">
            <div className="relative">
              <Search className="absolute left-2 top-2 w-3.5 h-3.5 text-slate-400 dark:text-slate-500" />
              <input 
                type="text" 
                placeholder={`Search ${label}...`} 
                className="w-full pl-8 pr-2 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded text-xs focus:outline-none focus:ring-1 focus:ring-indigo-500 placeholder:text-slate-400 dark:text-slate-200"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-60 overflow-y-auto p-1 custom-scrollbar">
            {filteredOptions.length > 0 ? (
              filteredOptions.map(opt => {
                const isSelected = selected.includes(opt);
                return (
                  <label 
                    key={opt} 
                    className={`flex items-center gap-3 px-3 py-2 rounded cursor-pointer text-xs transition-colors ${isSelected ? 'bg-indigo-50 text-indigo-700 font-medium dark:bg-indigo-900/30 dark:text-indigo-100' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                  >
                    <input 
                      type="checkbox" 
                      className="w-3.5 h-3.5 rounded border-slate-300 dark:border-slate-600 text-indigo-600 focus:ring-indigo-500 dark:focus:ring-indigo-500 dark:bg-slate-800"
                      checked={isSelected}
                      onChange={() => toggleOption(opt)}
                    />
                    <span className="truncate flex-1">{opt}</span>
                  </label>
                );
              })
            ) : (
              <div className="p-4 text-center text-xs text-slate-400 dark:text-slate-500">No results found</div>
            )}
          </div>

          <div className="p-2 border-t border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex justify-between">
            <button onClick={() => onChange([])} className="text-[10px] text-slate-500 dark:text-slate-400 font-bold hover:text-rose-600 dark:hover:text-rose-400 px-2" disabled={selected.length === 0}>CLEAR</button>
            <button onClick={() => setIsOpen(false)} className="text-[10px] bg-indigo-600 text-white px-3 py-1 rounded font-bold hover:bg-indigo-700 shadow-sm transition-colors">DONE</button>
          </div>
        </div>
      )}
    </div>
  );
};

export default MultiSelectFilter;