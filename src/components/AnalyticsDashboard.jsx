import React, { useMemo } from "react";
import { format, parseISO, subDays, differenceInDays } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from 'recharts';
import { Smile, Frown, TrendingUp, Clock, AlertCircle, ExternalLink, Trophy, Medal, Crown, User } from "lucide-react";
import { getCSATStatus, formatRWT, FLAT_TEAM_MAP } from "../utils"; 
import { useTicketStore } from "../store";

// 🛑 CONFIG: Blacklist specific names here
const HIDDEN_USERS = ["System", "DevRev Bot", "A", "V", "n", "Undefined", "null"];

const AnalyticsDashboard = ({ tickets, dateRange, filterOwner }) => {
  const { theme } = useTicketStore();
  const isDark = theme === 'dark';

  const colors = {
    grid: isDark ? "#1e293b" : "#f1f5f9",
    text: isDark ? "#94a3b8" : "#64748b",
    tooltipBg: isDark ? "#0f172a" : "#ffffff",
    tooltipBorder: isDark ? "#334155" : "#e2e8f0",
    lineVol: isDark ? "#818cf8" : "#4f46e5",
    lineWait: isDark ? "#fbbf24" : "#d97706",
    lineGood: isDark ? "#34d399" : "#10b981",
    lineBad: isDark ? "#f87171" : "#f43f5e",
  };

  const CustomTooltip = ({ active, payload, label }) => {
    if (active && payload && payload.length) {
      return (
        <div 
          className="p-3 rounded-lg shadow-xl text-xs border"
          style={{ backgroundColor: colors.tooltipBg, borderColor: colors.tooltipBorder, color: isDark ? '#fff' : '#1e293b' }}
        >
          <p className="font-bold mb-2 opacity-80">{label}</p>
          {payload.map((p, index) => (
            <div key={index} className="flex items-center gap-2 mb-1">
              <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
              <span className="opacity-70 capitalize">{p.name}:</span>
              <span className="font-mono font-bold">{p.value}</span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  // --- LOGIC: Calculate Charts & ALL Performers ---
  const { chartData, badTickets, allPerformers } = useMemo(() => {
    const daysMap = {};
    const badList = [];
    const ownerStats = {}; 

    const numDays = (dateRange.start && dateRange.end) 
      ? differenceInDays(parseISO(dateRange.end), parseISO(dateRange.start)) + 1 
      : 70; 
    const endDate = dateRange.end ? parseISO(dateRange.end) : new Date();

    // 1. Initialize Chart Days
    for (let i = numDays - 1; i >= 0; i--) {
      const d = subDays(endDate, i);
      const key = format(d, "yyyy-MM-dd");
      daysMap[key] = { date: format(d, "MMM dd"), created: 0, rwtSum: 0, rwtCount: 0, good: 0, bad: 0 };
    }

    // 2. Process Tickets
    tickets.forEach(t => {
      const ownerId = t.owned_by?.[0]?.display_id;
      
      // ✅ CHECK 1: Must be in our Official Team Map (To block bots)
      if (ownerId && FLAT_TEAM_MAP[ownerId]) {
          
          // 🔥 FIX: Use the REAL NAME from the ticket, not the manual map
          let realName = t.owned_by?.[0]?.display_name || FLAT_TEAM_MAP[ownerId];
          
          if (typeof realName !== 'string') realName = "";
          realName = realName.trim();

          // ✅ CHECK 2: STRICT FILTER (No short names, no blacklisted users)
          if (realName && realName.length > 2 && !HIDDEN_USERS.includes(realName)) {
              if (!ownerStats[realName]) ownerStats[realName] = { 
                name: realName, 
                good: 0, 
                bad: 0, 
                total: 0,
                id: ownerId
              };
              
              const sentiment = getCSATStatus(t);
              if (sentiment === "Good") ownerStats[realName].good += 1;
              if (sentiment === "Bad") ownerStats[realName].bad += 1;
              ownerStats[realName].total += 1;
          }
      }

      // --- Chart Calculation ---
      if (!t.created_date) return;
      const dateKey = format(parseISO(t.created_date), "yyyy-MM-dd");
      const sentiment = getCSATStatus(t);
      const isBad = sentiment === "Bad";
      const matchesOwner = filterOwner === "All" || (t.owned_by?.[0]?.display_id === filterOwner.split(" ")[0]); 
      
      if (isBad && matchesOwner) badList.push(t);

      if (daysMap[dateKey]) {
        daysMap[dateKey].created += 1;
        if (sentiment === "Good") daysMap[dateKey].good += 1;
        if (isBad) daysMap[dateKey].bad += 1;
        
        const rwt = formatRWT(t.custom_fields?.tnt__customer_wait_time);
        if (rwt > 0) {
          const hours = rwt / (1000 * 60 * 60);
          daysMap[dateKey].rwtSum += hours;
          daysMap[dateKey].rwtCount += 1;
        }
      }
    });

    // 3. Sort ALL Performers
    const sortedPerformers = Object.values(ownerStats)
      .map(p => ({
          ...p,
          winRate: p.total > 0 ? Math.round((p.good / p.total) * 100) : 0
      }))
      .sort((a, b) => {
         // Sort by Good tickets first
         if (b.good !== a.good) return b.good - a.good;
         // If tied, sort by Win Rate
         return b.winRate - a.winRate;
      }); 

    return { 
      chartData: Object.values(daysMap).map(d => ({
        ...d, 
        avgRwt: d.rwtCount > 0 ? parseFloat((d.rwtSum / d.rwtCount).toFixed(1)) : 0
      })),
      badTickets: badList,
      allPerformers: sortedPerformers
    };
  }, [tickets, dateRange, filterOwner]);

  // Split into Top 3 and Runners Up
  const podium = [allPerformers[1], allPerformers[0], allPerformers[2]]; 
  const runnersUp = allPerformers.slice(3);

  return (
    <div className="space-y-8 animate-in fade-in pb-20">
      
      {/* SECTION 1: CHAMPIONS ARENA */}
      <div className="flex flex-col xl:flex-row gap-6">
        
        {/* 70% Width: The Podium */}
        <div className="xl:w-[70%] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-6 shadow-sm relative overflow-hidden transition-colors">
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-transparent via-indigo-500 to-transparent opacity-50"></div>
            
            <div className="flex items-center justify-between mb-8">
                <h3 className="font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-amber-500" /> CSAT Champions
                </h3>
                <span className="text-xs font-medium text-slate-400 bg-slate-100 dark:bg-slate-800 px-3 py-1 rounded-full">
                    Top Performers
                </span>
            </div>

            <div className="flex items-end justify-center gap-2 sm:gap-6 h-72 sm:h-96 pb-2">
                {podium.map((person, idx) => {
                    if (!person) return null;
                    
                    const isGold = idx === 1;
                    const rank = isGold ? 1 : idx === 0 ? 2 : 3;
                    
                    // 🚀 FIX: Increased non-gold height to 65% so text fits
                    const heightClass = isGold ? 'h-full' : 'h-[65%]';
                    
                    // 🚀 FIX: Only Gold gets large padding (pt-10). Others get small padding (pt-3)
                    const paddingClass = isGold ? 'pt-10' : 'pt-3';
                    
                    const colorClass = isGold 
                        ? 'from-amber-100 to-amber-50/10 border-amber-200 text-amber-600 dark:from-amber-500/20 dark:to-slate-900 dark:border-amber-500/50 dark:text-amber-400' 
                        : rank === 2 
                            ? 'from-slate-200 to-slate-50/10 border-slate-300 text-slate-600 dark:from-slate-600/20 dark:to-slate-900 dark:border-slate-500/50 dark:text-slate-400'
                            : 'from-orange-100 to-orange-50/10 border-orange-200 text-orange-700 dark:from-orange-600/20 dark:to-slate-900 dark:border-orange-500/50 dark:text-orange-400';

                    return (
                        <div key={person.name} className={`relative flex flex-col items-center justify-end w-1/3 max-w-[180px] ${heightClass} transition-all duration-700 ease-out`}>
                            
                            {/* Avatar & Badge (Lifted -mt-16) */}
                            <div className={`relative mb-4 flex flex-col items-center z-20 ${isGold ? '-mt-16' : ''}`}>
                                {isGold && <Crown className="w-10 h-10 text-amber-500 mb-2 animate-bounce" fill="currentColor" />}
                                <div className={`w-14 h-14 sm:w-20 sm:h-20 rounded-full flex items-center justify-center text-2xl font-bold border-4 shadow-xl bg-white dark:bg-slate-800 ${colorClass.split(' ')[2]}`}>
                                    {person.name.charAt(0)}
                                </div>
                                <div className={`absolute -bottom-3 px-3 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white dark:bg-slate-800 border shadow-md ${colorClass.split(' ')[2]}`}>
                                    Rank #{rank}
                                </div>
                            </div>

                            {/* The Bar */}
                            <div className={`w-full rounded-t-3xl border-t border-x bg-gradient-to-b ${colorClass} flex flex-col items-center justify-start ${paddingClass} pb-4 shadow-sm relative overflow-hidden group hover:opacity-90 cursor-pointer`}>
                                {isGold && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-40 h-40 bg-amber-400/20 blur-[60px] rounded-full pointer-events-none"></div>}
                                
                                {/* 🚀 FIX: Removed forced color class. Added relative + z-20 */}
                                <h4 className="font-bold text-sm sm:text-base text-center px-1 mb-2 truncate w-full z-20 relative">
                                    {person.name}
                                </h4>

                                <div className="flex items-center gap-1 bg-white/60 dark:bg-black/30 px-4 py-1.5 rounded-full z-10 backdrop-blur-md shadow-sm border border-white/20">
                                    <Smile className="w-4 h-4" />
                                    <span className="text-sm font-bold">{person.good}</span>
                                </div>
                                <p className="text-[10px] mt-3 opacity-70 z-10 font-medium">{person.winRate}% Positive</p>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>

        {/* 30% Width: The Leaderboard List */}
        <div className="xl:w-[30%] bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-0 shadow-sm flex flex-col overflow-hidden transition-colors">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50">
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-sm flex items-center gap-2">
                    <Medal className="w-4 h-4 text-slate-400" /> Honorable Mentions
                </h3>
            </div>
            
            <div className="overflow-y-auto max-h-[400px] p-2 space-y-1 custom-scrollbar">
                {runnersUp.length === 0 ? (
                    <div className="h-full flex flex-col items-center justify-center text-slate-400 text-xs py-10">
                        <User className="w-8 h-8 mb-2 opacity-20" />
                        <p>No other active agents.</p>
                    </div>
                ) : (
                    runnersUp.map((person, idx) => (
                        <div key={person.name} className="flex items-center gap-3 p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors group border border-transparent hover:border-slate-100 dark:hover:border-slate-700">
                            <span className="text-xs font-bold text-slate-400 w-4 text-center">#{idx + 4}</span>
                            
                            <div className="w-8 h-8 rounded-full bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 flex items-center justify-center text-xs font-bold">
                                {person.name.charAt(0)}
                            </div>
                            
                            <div className="flex-1 min-w-0">
                                <div className="flex justify-between items-center mb-1">
                                    <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{person.name}</p>
                                    <span className="text-[10px] font-medium text-slate-500">{person.good} Good</span>
                                </div>
                                <div className="w-full h-1.5 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                                    <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${person.winRate}%` }}></div>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>

      </div>

     

      {/* SECTION 3: CHARTS */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        
        <ChartCard title="Ticket Creation Volume" icon={TrendingUp} color="text-indigo-500" isDark={isDark}>
          <AreaChart data={chartData}>
            <defs>
              <linearGradient id="colorCreated" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={colors.lineVol} stopOpacity={0.3}/>
                <stop offset="95%" stopColor={colors.lineVol} stopOpacity={0}/>
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
            <XAxis dataKey="date" fontSize={10} stroke={colors.text} tickMargin={10} minTickGap={40} axisLine={false} tickLine={false} />
            <YAxis fontSize={10} stroke={colors.text} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: colors.grid }} />
            <Area type="monotone" dataKey="created" stroke={colors.lineVol} strokeWidth={2} fill="url(#colorCreated)" name="Tickets" />
          </AreaChart>
        </ChartCard>

        <ChartCard title="Avg Wait Time (Hours)" icon={Clock} color="text-amber-500" isDark={isDark}>
           <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={colors.grid} />
            <XAxis dataKey="date" fontSize={10} stroke={colors.text} tickMargin={10} minTickGap={30} axisLine={false} tickLine={false} />
            <YAxis fontSize={10} stroke={colors.text} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} cursor={{ stroke: colors.grid }} />
            <Line type="monotone" dataKey="avgRwt" stroke={colors.lineWait} strokeWidth={3} dot={false} activeDot={{r: 6}} name="Hours" />
          </LineChart>
        </ChartCard>

      </div>

       {/* SECTION 2: ALERTS (Negative Feedback) */}
      {badTickets.length > 0 && (
        <div className="bg-rose-50/50 dark:bg-rose-900/10 border border-rose-100 dark:border-rose-900/50 rounded-xl p-6 transition-colors">
          <h3 className="text-rose-800 dark:text-rose-400 font-bold flex items-center gap-2 mb-4 text-xs uppercase tracking-wide">
            <AlertCircle className="w-4 h-4" /> Negative Feedback ({badTickets.length})
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {badTickets.map(t => (
              <div key={t.id} className="bg-white dark:bg-slate-800 p-4 rounded-lg shadow-sm border border-rose-100 dark:border-rose-900/30 hover:border-rose-300 transition-all cursor-pointer group">
                <div className="flex justify-between items-start mb-2">
                  <span className="text-[10px] font-bold text-slate-400 font-mono bg-slate-50 dark:bg-slate-700 px-1.5 py-0.5 rounded">{t.display_id}</span>
                  <a href={`https://app.devrev.ai/clevertapsupport/works/${t.display_id}`} target="_blank" className="text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all"><ExternalLink className="w-3 h-3" /></a>
                </div>
                <p className="text-sm font-medium text-slate-800 dark:text-slate-200 line-clamp-2 mb-3">{t.title}</p>
                <div className="flex justify-between items-center">
                   <div className="flex items-center gap-1.5 text-[10px] font-bold text-rose-700 dark:text-rose-300 bg-rose-50 dark:bg-rose-900/50 px-2 py-1 rounded-full">
                     <Frown className="w-3 h-3" /> BAD RATING
                   </div>
                   <span className="text-[10px] text-slate-400">{format(parseISO(t.created_date), "MMM d")}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      
    </div>
  );
};

const ChartCard = ({ title, icon: Icon, color, children, isDark }) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm h-80 transition-colors">
    <h3 className={`text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-6 flex items-center gap-2`}>
      <Icon className={`w-4 h-4 ${color}`} /> {title}
    </h3>
    <ResponsiveContainer width="100%" height="85%">{children}</ResponsiveContainer>
  </div>
);

export default AnalyticsDashboard;