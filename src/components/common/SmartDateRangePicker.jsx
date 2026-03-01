import React, { useState, useRef, useEffect, useMemo } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { format, subDays, startOfDay, endOfDay, differenceInCalendarDays } from "date-fns";

const SmartDateRangePicker = ({ value, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [showCustomRange, setShowCustomRange] = useState(false);
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [rangeError, setRangeError] = useState("");
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
    const yesterday = subDays(today, 1);

    return [
      { label: "Today", value: {
        start: format(startOfDay(today), "yyyy-MM-dd"),
        end: format(endOfDay(today), "yyyy-MM-dd"),
      }},
      { label: "Yesterday", value: {
        start: format(startOfDay(yesterday), "yyyy-MM-dd"),
        end: format(endOfDay(yesterday), "yyyy-MM-dd"),
      }},
      { label: "Last 7 Days", value: {
        start: format(subDays(today, 6), "yyyy-MM-dd"),
        end: format(today, "yyyy-MM-dd"),
      }},
    ];
  }, []);

  // Get display label
  const displayLabel = useMemo(() => {
    if (!value?.start && !value?.end) return "Select Date";

    // Single day
    if (value?.start === value?.end) {
      const matchedPreset = presets.find(
        p => p.value.start === value.start && p.value.end === value.end,
      );
      if (matchedPreset) return matchedPreset.label;
      try {
        return format(new Date(value.start), "MMM d, yyyy");
      } catch {
        return "Custom Date";
      }
    }

    // Check if matches a preset
    const matchedPreset = presets.find(
      p => p.value.start === value?.start && p.value.end === value?.end,
    );
    if (matchedPreset) return matchedPreset.label;

    // Format custom range
    if (value?.start && value?.end) {
      try {
        const start = new Date(value.start);
        const end = new Date(value.end);
        return `${format(start, "MMM d")} - ${format(end, "MMM d")}`;
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

  const handleCustomRange = () => {
    if (!customStart || !customEnd) return;

    const s = new Date(customStart);
    const e = new Date(customEnd);
    const diff = differenceInCalendarDays(e, s);

    if (diff < 0) {
      setRangeError("End date must be after start date");
      return;
    }

    setRangeError("");
    onChange({ start: customStart, end: customEnd });
    setShowCustomRange(false);
    setIsOpen(false);
  };

  // Reset error when dates change
  const handleCustomStartChange = (val) => {
    setCustomStart(val);
    setRangeError("");
  };
  const handleCustomEndChange = (val) => {
    setCustomEnd(val);
    setRangeError("");
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
        <div className="absolute top-full mt-2 w-64 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xl z-50 overflow-hidden">
          {/* Presets */}
          <div className="p-2 border-b border-slate-100 dark:border-slate-800">
            <div className="flex flex-col gap-1">
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

          {/* Custom Range */}
          <div className="p-2">
            <button
              onClick={() => setShowCustomRange(!showCustomRange)}
              className="w-full text-xs text-left text-slate-500 dark:text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {showCustomRange ? "\u25BC Custom Range" : "\u25B6 Custom Range"}
            </button>

            {showCustomRange && (
              <div className="mt-2 space-y-2">
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 w-12">From:</label>
                  <input
                    type="date"
                    value={customStart}
                    onChange={(e) => handleCustomStartChange(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <label className="text-xs text-slate-500 w-12">To:</label>
                  <input
                    type="date"
                    value={customEnd}
                    onChange={(e) => handleCustomEndChange(e.target.value)}
                    className="flex-1 px-2 py-1.5 text-xs border border-slate-200 dark:border-slate-700 rounded bg-white dark:bg-slate-800 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>
                {rangeError && (
                  <p className="text-[11px] text-rose-500 font-medium">{rangeError}</p>
                )}
                <p className="text-[10px] text-slate-400">Select any date range</p>
                <button
                  onClick={handleCustomRange}
                  disabled={!customStart || !customEnd}
                  className="w-full px-3 py-1.5 text-xs bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
                >
                  Apply
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default SmartDateRangePicker;
