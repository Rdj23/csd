import React, { useState, useRef, useEffect } from "react";
import { Calendar, ChevronDown, X, ChevronRight } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, subMonths, startOfYear } from "date-fns";

const PRESETS = [
  { label: "Today", getValue: () => ({ start: new Date(), end: new Date() }) },
  { label: "Last 7 Days", getValue: () => ({ start: subDays(new Date(), 6), end: new Date() }) },
  { label: "Last 30 Days", getValue: () => ({ start: subDays(new Date(), 29), end: new Date() }) },
  { label: "This Month", getValue: () => ({ start: startOfMonth(new Date()), end: endOfMonth(new Date()) }) },
  { label: "Previous Month", getValue: () => ({ start: startOfMonth(subMonths(new Date(), 1)), end: endOfMonth(subMonths(new Date(), 1)) }) },
];

const SmartDatePicker = ({ onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomInput, setShowCustomInput] = useState(false); // Controls right panel visibility
  const [selectedLabel, setSelectedLabel] = useState("All Time");
  const [customRange, setCustomRange] = useState({ start: "", end: "" });
  const containerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setIsOpen(false);
        setShowCustomInput(false); // Reset view on close
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // 1. Handle Standard Presets (Immediate Apply)
  const applyPreset = (preset) => {
    const range = preset.getValue();
    const startStr = format(range.start, "yyyy-MM-dd");
    const endStr = format(range.end, "yyyy-MM-dd");
    
    setSelectedLabel(preset.label);
    setCustomRange({ start: startStr, end: endStr });
    onChange({ start: startStr, end: endStr });
    
    setIsOpen(false);
    setShowCustomInput(false);
  };

  // 2. Handle "All Time" (Clear Filter)
  const clearDate = (e) => {
    if(e) e.stopPropagation();
    setSelectedLabel("All Time");
    setCustomRange({ start: "", end: "" });
    onChange({ start: "", end: "" });
    setIsOpen(false);
    setShowCustomInput(false);
  };

  // 3. Handle Custom Range Apply
  const handleCustomApply = () => {
    if (customRange.start && customRange.end) {
      const startFmt = format(new Date(customRange.start), "MMM d");
      const endFmt = format(new Date(customRange.end), "MMM d");
      setSelectedLabel(`${startFmt} - ${endFmt}`);
      onChange(customRange);
      setIsOpen(false);
      setShowCustomInput(false);
    }
  };

  const isActive = selectedLabel !== "All Time";

  return (
    <div className="relative" ref={containerRef}>
      {/* TRIGGER BUTTON */}
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all whitespace-nowrap shadow-sm
        ${isActive 
          ? 'bg-white border-indigo-600 text-indigo-600 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-200' 
          : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400 dark:hover:border-slate-600'}`}
      >
        <Calendar className={`w-3.5 h-3.5 ${isActive ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400 dark:text-slate-500'}`} />
        <span className="max-w-[120px] truncate">{selectedLabel}</span>
        {isActive ? (
          <div onClick={clearDate} className="p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700 text-indigo-600 dark:text-indigo-400">
            <X className="w-3 h-3" />
          </div>
        ) : (
          <ChevronDown className="w-3 h-3 opacity-50" />
        )}
      </button>

      {/* DROPDOWN */}
      {isOpen && (
        <div className="absolute top-full mt-2 left-0 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden ring-1 ring-black/5 animate-in fade-in zoom-in-95 duration-100 flex flex-row">
          
          {/* LEFT COLUMN: LIST */}
          <div className="p-1 w-36 bg-slate-50/50 dark:bg-slate-800/30">
            {/* All Time Option */}
            <button 
              onClick={() => clearDate()}
              className={`w-full text-left px-3 py-2 text-xs rounded flex justify-between items-center mb-0.5 transition-all
              ${selectedLabel === "All Time" 
                ? 'bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-900/30 dark:text-indigo-300' 
                : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'}`}
            >
              All Time
            </button>

            {/* Standard Presets */}
            {PRESETS.map((preset) => (
              <button 
                key={preset.label} 
                onClick={() => applyPreset(preset)}
                className={`w-full text-left px-3 py-2 text-xs rounded flex justify-between items-center mb-0.5 transition-all
                ${selectedLabel === preset.label 
                  ? 'bg-indigo-50 text-indigo-700 font-bold dark:bg-indigo-900/30 dark:text-indigo-300' 
                  : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'}`}
              >
                {preset.label}
              </button>
            ))}

            {/* Custom Range Trigger */}
            <button 
              onClick={() => setShowCustomInput(true)}
              className={`w-full text-left px-3 py-2 text-xs rounded flex justify-between items-center transition-all
              ${showCustomInput 
                ? 'bg-white shadow-sm text-indigo-600 font-bold dark:bg-slate-800 dark:text-indigo-400' 
                : 'text-slate-700 dark:text-slate-300 hover:bg-white dark:hover:bg-slate-700'}`}
            >
              Custom Range
              <ChevronRight className="w-3 h-3 opacity-50" />
            </button>
          </div>

          {/* RIGHT COLUMN: INPUTS (Only visible if showCustomInput is true) */}
          {showCustomInput && (
            <div className="p-4 bg-white dark:bg-slate-900 w-48 flex flex-col justify-center border-l border-slate-100 dark:border-slate-800 animate-in slide-in-from-left-2 fade-in duration-200">
              <p className="text-[10px] font-bold text-slate-400 uppercase mb-3 tracking-wider">Select Range</p>
              
              <div className="space-y-3">
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">From</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" 
                    value={customRange.start} 
                    onChange={(e) => setCustomRange(p => ({...p, start: e.target.value}))} 
                  />
                </div>
                
                <div>
                  <label className="block text-[10px] text-slate-500 mb-1">To</label>
                  <input 
                    type="date" 
                    className="w-full bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-2 py-1.5 text-xs text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-indigo-500" 
                    value={customRange.end} 
                    onChange={(e) => setCustomRange(p => ({...p, end: e.target.value}))} 
                  />
                </div>

                <button 
                  onClick={handleCustomApply} 
                  className="w-full bg-indigo-600 text-white text-xs font-bold py-2 rounded-lg hover:bg-indigo-700 transition-colors shadow-md shadow-indigo-500/20 mt-2"
                >
                  APPLY RANGE
                </button>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default SmartDatePicker;