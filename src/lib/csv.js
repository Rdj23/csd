/**
 * CSV export — building the file and handing it to the browser.
 *
 * WHY THIS EXISTS: the blob/anchor/click/revoke dance was copy-pasted five
 * times across App.jsx, Allticketsview.jsx (twice), the analytics
 * DrillDownModal and NOCAnalytics. Each copy had drifted slightly — two used
 * `text/csv`, three `text/csv;charset=utf-8;`; one hand-rolled the timestamp
 * with getFullYear()/padStart while the rest used date-fns. Every copy is now
 * this one function.
 *
 * The charset is always declared: without it Excel mis-renders non-ASCII
 * customer and account names.
 */
import { format } from "date-fns";

/** Timestamp suffix shared by every export: "2026-08-29_1730" (local time). */
export const csvTimestamp = () => format(new Date(), "yyyy-MM-dd_HHmm");

/** Make an arbitrary label safe to sit in a filename. */
export const csvSafeName = (label, fallback = "export") =>
  (label || fallback).replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "");

/**
 * Trigger a browser download of `content` as `filename`.
 *
 * The object URL is revoked immediately after click(). That is safe because
 * the browser has already taken its own reference to the blob by then, and it
 * is what stops long dashboard sessions from leaking every export they make.
 */
export const downloadCsv = (filename, content) => {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
};

/** Join header + pre-formatted rows into a CSV document. */
export const toCsv = (headers, rows) => [headers.join(","), ...rows].join("\n");
