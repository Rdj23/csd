import React, { useEffect, useState } from "react";
import {
  X,
  ShieldAlert,
  TrendingUp,
  Clock,
  BellRing,
  CheckCircle,
} from "lucide-react";
import axios from "axios";
import { differenceInMinutes, parseISO } from "date-fns";
import { TEAM_GROUPS } from "../utils";

const ProfileStatsModal = ({ user, tickets, onClose, solvedTickets = [] }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const [backup, setBackup] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true);
        const API_BASE = import.meta.env.VITE_API_URL || "http://localhost:5000";

        // 1. Fetch backup from improved endpoint
        const backupRes = await axios.get(`${API_BASE}/api/roster/backup?userName=${encodeURIComponent(user.name)}&teamOnly=true`);
        setBackup(backupRes.data.backup);

        // 2. Get profile status
        const statusRes = await axios.post(`${API_BASE}/api/profile/status`, { userName: user.name });

        setData({
         
          isActive: statusRes.data.isActive,
          status: statusRes.data.status,
          timings: statusRes.data.shift,
          aiSummary: backupRes.data.backup 
            ? `${user.name} is working. Best backup: ${backupRes.data.backup.name} (${backupRes.data.backup.role}) with ${backupRes.data.backup.currentLoad} active tickets.`
            : statusRes.data.isActive 
              ? `${user.name} is on shift. No teammates currently available.`
              : `${user.name} is off duty today.`,
        });
      } catch (err) {
        console.error("Failed to load profile info", err);
        setData({
         
          isActive: false,
          status: "Unknown",
        });
      } finally {
        setLoading(false);
      }
    };

    if (user) fetchData();
  }, [user, solvedTickets]);

 

  if (!user) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="absolute inset-0" onClick={onClose}></div>
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 w-full max-w-lg max-h-[85vh] flex flex-col relative z-10 overflow-hidden">
        {/* HEADER */}
        <div className="bg-slate-50 dark:bg-slate-800/50 p-6 border-b border-slate-100 dark:border-slate-800 flex justify-between items-start shrink-0">
          <div className="flex items-center gap-4">
            <div
              className={`relative w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold border-4 transition-colors ${
                loading
                  ? "border-slate-200"
                  : data?.isActive
                  ? "bg-emerald-100 text-emerald-600 border-emerald-200"
                  : "bg-slate-100 text-slate-500 border-slate-200"
              }`}
            >
              {user.name[0]}
              {!loading && (
                <div
                  className={`absolute bottom-0 right-0 w-4 h-4 rounded-full border-2 border-white ${
                    data?.isActive ? "bg-emerald-500" : "bg-amber-500"
                  }`}
                />
              )}
            </div>
            <div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                {user.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                {!loading ? (
                  data?.status === "Not in Roster" ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider bg-rose-100 text-rose-700">
                      Roster Mismatch
                    </span>
                  ) : (
                    <span
                      className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        data?.isActive
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {data?.isActive ? "In Shift" : data?.status || "Away"}
                    </span>
                  )
                ) : (
                  <span className="h-5 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
                )}

                {data?.timings && (
                  <span className="text-xs text-slate-500 font-mono flex items-center gap-1">
                    <Clock className="w-3 h-3" /> {data.timings}
                  </span>
                )}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full transition-colors"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* BODY */}
        <div className="p-6 space-y-6 overflow-y-auto">
          {data?.status === "Not in Roster" && data?.candidates && (
            <div className="p-3 bg-rose-50 border border-rose-200 rounded-lg text-xs text-rose-700">
              <p className="font-bold">⚠️ Name mismatch detected.</p>
              <p>Did you mean: {data.candidates.join(", ")}?</p>
            </div>
          )}

          {/* AI INSIGHT */}
          <div className="bg-indigo-50 dark:bg-indigo-900/20 p-4 rounded-xl border border-indigo-100 dark:border-indigo-800/50 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 opacity-10">
              <TrendingUp className="w-24 h-24 text-indigo-600" />
            </div>
            <h3 className="text-xs font-bold text-indigo-600 dark:text-indigo-400 uppercase tracking-wider mb-2 flex items-center gap-2">
              <ShieldAlert className="w-3.5 h-3.5" /> Live Workload
            </h3>
            <p className="text-sm font-medium text-slate-700 dark:text-indigo-100 leading-relaxed relative z-10">
              {loading ? "Analyzing..." : data?.aiSummary}
            </p>
          </div>

          {/* BACKUP CARD */}
<div className="p-3 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
  <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-2">
    Recommended Backup
  </div>
  
  {backup ? (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/50 flex items-center justify-center text-indigo-600 dark:text-indigo-400 font-bold text-xs">
          {backup.name.charAt(0)}
        </div>
        <div>
          <p className="text-sm font-bold text-slate-700 dark:text-slate-200">
            {backup.name}
          </p>
          <p className="text-[10px] text-slate-500">
            {backup.role} • <span className="text-green-600 font-medium">{backup.load} Active Now</span>
          </p>
        </div>
      </div>
      {/* Optional: Assign Button */}
      <button className="text-xs bg-white dark:bg-slate-700 border border-slate-200 dark:border-slate-600 px-2 py-1 rounded hover:bg-slate-50 dark:hover:bg-slate-600 transition-colors">
        Assign
      </button>
    </div>
  ) : (
    <div className="text-xs text-slate-400 italic py-2 text-center">
      No teammates online 🌙
    </div>
  )}
</div>
         

        
        </div>
      </div>
    </div>
  );
};
export default ProfileStatsModal;
