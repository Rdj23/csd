import React, { useState, useRef, useEffect, useMemo } from "react";
import { Calendar, ChevronDown, X } from "lucide-react";
import { format, subDays, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, subMonths, startOfDay, endOfDay } from "date-fns";

const SmartDateRangePicker = ({ value, onChange, allowAllTime = true }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customDays, setCustomDays] = useState("");
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
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

  // Preset date ranges
  const presets = useMemo(() => {
    const today = new Date();
    const presetList = [];

    if (allowAllTime) {
      presetList.push({ label: "All Time", value: { start: "", end: "" } });
    }

    presetList.push(
      { label: "Today", value: { 
        start: format(startOfDay(today), "yyyy-MM-dd"), 
        end: format(endOfDay(today), "yyyy-MM-dd") 
      }},
      { label: "Last 7 Days", value: { 
        start: format(subDays(today, 7), "yyyy-MM-dd"), 
        end: format(today, "yyyy-MM-dd") 
      }},
      { label: "Last 14 Days", value: { 
        start: format(subDays(today, 14), "yyyy-MM-dd"), 
        end: format(today, "yyyy-MM-dd") 
      }},
      { label: "Last 30 Days", value: { 
        start: format(subDays(today, 30), "yyyy-MM-dd"), 
        end: format(today, "yyyy-MM-dd") 
      }},
      { label: "This Month", value: { 
        start: format(startOfMonth(today), "yyyy-MM-dd"), 
        end: format(endOfMonth(today), "yyyy-MM-dd") 
      }},
      { label: "Previous Month", value: { 
        start: format(startOfMonth(subMonths(today, 1)), "yyyy-MM-dd"), 
        end: format(endOfMonth(subMonths(today, 1)), "yyyy-MM-dd") 
      }},
      // Q1'26: Jan 1 - Mar 31, 2026
      { label: "Q1'26", value: { 
        start: "2026-01-01", 
        end: "2026-03-31" 
      }},
      // Q4'25: Oct 1 - Dec 31, 2025
      // { label: "Q4'25", value: { 
      //   start: "2025-10-01", 
      //   end: "2025-12-31" 
      // }},
      // Q3'25: Jul 1 - Sep 30, 2025
      // { label: "Q3'25", value: { 
      //   start: "2025-07-01", 
      //   end: "2025-09-30" 
      // }}
    );

    return presetList;
  }, [allowAllTime]);

  // Get display label
  const displayLabel = useMemo(() => {
    if (!value?.start && !value?.end) return "All Time";
    
    // Check if matches a preset
    const matchedPreset = presets.find(
      p => p.value.start === value?.start && p.value.end === value?.end
    );
    if (matchedPreset) return matchedPreset.label;

    // Format custom range
    if (value?.start && value?.end) {
      try {
        const start = new Date(value.start);
        const end = new Date(value.end);
        return `${format(start, "MMM d")} - ${format(end, "MMM d, yyyy")}`;
      } catch {
        return "Custom Range";
      }
    }
    return "Select Date";
  }, [value, presets]);

  const handlePresetClick = (preset) => {
    onChange(preset.value);
    setIsOpen(false);
  };

  const handleLastXDays = () => {
    const days = parseInt(customDays);
    if (days > 0) {
      const today = new Date();
      onChange({
        start: format(subDays(today, days), "yyyy-MM-dd"),
        end: format(today, "yyyy-MM-dd")
      });
      setCustomDays("");
      setIsOpen(false);
    }
  };

  const handleCustomRange = () => {
    if (customStart && customEnd) {
      onChange({ start: customStart, end: customEnd });
      setShowCustomRange(false);
      setIsOpen(false);
    }
  };

  return (
    <div className="relative" ref={containerRef}>
      <button 
        onClick={() => setIsOpen(!isOpen)} 
        className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium border transition-all whitespace-nowrap shadow-sm ${
          value?.start 
            ? 'bg-white border-indigo-600 text-indigo-600 dark:bg-indigo-900/40 dark:border-indigo-500/50 dark:text-indigo-200' 
            : 'bg-white border-slate-200 text-slate-600 hover:border-slate-300 dark:bg-slate-800 dark:border-slate-700 dark:text-slate-400'
        }`}
      >
        <Calendar className={`w-3.5 h-3.5 ${value?.start ? 'text-indigo-600 dark:text-indigo-400' : 'text-slate-400'}`} />
        <span>{displayLabel}</span>
        <ChevronDown className="w-3 h-3 opacity-50" />
      </button>

      {isOpen && (
        <div className="absolute top-full mt-2 w-72 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Presets */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="grid grid-cols-2 gap-1">
              {presets.map((preset) => (
                <button
                  key={preset.label}
                  onClick={() => handlePresetClick(preset)}
                  className={`px-3 py-2 text-xs rounded-lg transition-colors text-left ${
                    value?.start === preset.value.start && value?.end === preset.value.end
                      ? 'bg-indigo-100 text-indigo-700 font-semibold dark:bg-indigo-900/40 dark:text-indigo-300'
                      : 'hover:bg-slate-100 text-slate-600 dark:text-slate-400 dark:hover:bg-slate-800'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </div>

          {/* Last X Days */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500 dark:text-slate-400">Last</span>
              <input
                type="number"
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
                placeholder="X"
                className="w-16 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 text-center focus:outline-none focus:ring-1 focus:ring-indigo-500"
                min="1"
              />
              <span className="text-xs text-slate-500 dark:text-slate-400">days</span>
              <button
                onClick={handleLastXDays}
                disabled={!customDays || parseInt(customDays) <= 0}
                className="px-2 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Apply
              </button>
            </div>
          </div>

          {/* Custom Range Toggle */}
          <div className="p-2">
            <button
              onClick={() => setShowCustomRange(!showCustomRange)}
              className="w-full text-xs text-left text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {showCustomRange ? "▼ Custom Range" : "▶ Custom Range"}
            </button>

            {showCustomRange && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 w-12">From:</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => setCustomStart(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 w-12">To:</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <button
                  onClick={handleCustomRange}
                  disabled={!customStart || !customEnd}
                  className="w-full px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  Apply Custom Range
                </button>
              </div>
            )}
          </div>

          {/* Clear */}
          {value?.start && (
            <div className="p-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => {
                  onChange({ start: "", end: "" });
                  setIsOpen(false);
                }}
                className="w-full text-xs text-rose-500 hover:text-rose-600 font-medium"
              >
                Clear Date Filter
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SmartDateRangePicker;