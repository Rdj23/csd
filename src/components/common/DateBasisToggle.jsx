import React from "react";

const OPTIONS = [
  { key: "created", label: "Created" },
  { key: "closed", label: "Solved" },
];

// Created / Solved segmented toggle that sits beside a date picker and says
// which ticket date the picked range applies to. value: "created" | "closed".
const DateBasisToggle = ({ value, onChange }) => (
  <div
    className="flex items-center gap-0.5 bg-slate-100 dark:bg-slate-800/80 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700/60"
    title="Apply the date range to the ticket's created date or its solved date"
  >
    {OPTIONS.map((opt) => (
      <button
        key={opt.key}
        onClick={() => onChange(opt.key)}
        className={`px-2.5 py-1.5 rounded-md text-xs font-medium transition-all duration-150 ${
          value === opt.key
            ? "bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-sm"
            : "text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
        }`}
      >
        {opt.label}
      </button>
    ))}
  </div>
);

export default DateBasisToggle;
