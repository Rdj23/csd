/**
 * Ticket status, SLA age and CSAT display logic.
 *
 * These decide what a ticket LOOKS like on the board — its status label, its
 * colour, its age. Business rules about what a status MEANS live on the
 * backend; this module is presentation only.
 */

import { AlertOctagon, AlertTriangle, CheckCircle, Smile, Frown } from "lucide-react";
import { differenceInMinutes, parseISO, differenceInDays } from "date-fns";

export const calculateResolutionTime = (createdISO, closedISO) => {
  if (!createdISO || !closedISO) return "N/A";
  
  const start = parseISO(createdISO);
  const end = parseISO(closedISO); // 2025-12-16T10:39:13.007Z
  
  const totalMinutes = differenceInMinutes(end, start);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  return `${hours}h ${minutes}m`;
};

export const STAGE_MAP = {
  "Waiting on Assignee": { label: "Open", color: "bg-blue-50 text-blue-700 border-blue-100" },
  "Awaiting Customer Reply": { label: "Pending", color: "bg-amber-50 text-amber-700 border-amber-100" },
  "Waiting on CleverTap": { label: "On Hold", color: "bg-purple-50 text-purple-700 border-purple-100" },
};

// --- DUAL SLA LOGIC ---
export const getTicketStatus = (createdDate, stageName, isCSD) => {
  if (!stageName) return { status: "Unknown", color: "bg-gray-100", icon: CheckCircle, priority: 4 };
  const lower = stageName.toLowerCase();
  
  // Solved/Closed -> Ignore
  if (lower.includes('solved') || lower.includes('closed')) {
    return { status: "Solved", color: "bg-slate-100 text-slate-500 border-slate-200", icon: CheckCircle, priority: 4, days: 0 };
  }

  const days = differenceInDays(new Date(), parseISO(createdDate));

  if (isCSD) {
    // Strict SLA for CSD
    if (days > 7) return { status: "Action Immediately", color: "text-rose-700 bg-rose-50 border-rose-200", icon: AlertOctagon, priority: 1, days };
    if (days >= 3) return { status: "Needs Attention", color: "text-amber-700 bg-amber-50 border-amber-200", icon: AlertTriangle, priority: 2, days };
    return { status: "Healthy", color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle, priority: 3, days };
  } else {
    // Standard SLA
    if (days > 15) return { status: "Action Immediately", color: "text-rose-700 bg-rose-50 border-rose-200", icon: AlertOctagon, priority: 1, days };
    if (days >= 10) return { status: "Needs Attention", color: "text-amber-700 bg-amber-50 border-amber-200", icon: AlertTriangle, priority: 2, days };
    return { status: "Healthy", color: "text-emerald-700 bg-emerald-50 border-emerald-200", icon: CheckCircle, priority: 3, days };
  }
};

export const getCSATStatus = (t) => {
  const oldRating = Number(t.custom_fields?.tnt__csatrating);
  if (oldRating === 2) return "Good";
  if (oldRating === 1) return "Bad";
  return null;
};

export const formatRWT = (epoch) => {
  if (!epoch) return 0;
  return Math.max(0, Date.now() - (epoch * 1000));
};
