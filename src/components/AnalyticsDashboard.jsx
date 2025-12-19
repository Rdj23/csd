import React, { useMemo } from "react";
import { format, parseISO, subDays, differenceInDays } from "date-fns";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, LineChart, Line } from 'recharts';
import { Smile, Frown, TrendingUp, Clock, AlertCircle, ExternalLink, Trophy, Medal, Crown } from "lucide-react";
import { getCSATStatus, formatRWT } from "../utils";
import { useTicketStore } from "../store";

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

  // --- LOGIC: Calculate Charts & Top Performers ---
  const { chartData, badTickets, topPerformers } = useMemo(() => {
    const daysMap = {};
    const badList = [];
    const ownerStats = {}; // To track scores per person

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
      // --- Owner Stats Calculation ---
      const ownerName = t.owned_by?.[0]?.display_name || "Unassigned";
      // Skip unassigned for leaderboard
      if (ownerName !== "Unassigned") {
          if (!ownerStats[ownerName]) ownerStats[ownerName] = { name: ownerName, good: 0, bad: 0, total: 0, avatar: t.owned_by?.[0]?.display_picture?.id || null };
          
          const sentiment = getCSATStatus(t);
          if (sentiment === "Good") ownerStats[ownerName].good += 1;
          if (sentiment === "Bad") ownerStats[ownerName].bad += 1;
          ownerStats[ownerName].total += 1;
      }

      // --- Chart Calculation ---
      if (!t.created_date) return;
      const dateKey = format(parseISO(t.created_date), "yyyy-MM-dd");
      const sentiment = getCSATStatus(t);
      const isBad = sentiment === "Bad";
      
      // Filter logic for Charts only (Top performers ignores filter to show global leaders)
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

    // 3. Sort Top Performers
    const sortedPerformers = Object.values(ownerStats)
      .sort((a, b) => b.good - a.good) // Sort by most "Good" ratings
      .slice(0, 3); // Take top 3

    return { 
      chartData: Object.values(daysMap).map(d => ({
        ...d, 
        avgRwt: d.rwtCount > 0 ? parseFloat((d.rwtSum / d.rwtCount).toFixed(1)) : 0
      })),
      badTickets: badList,
      topPerformers: sortedPerformers
    };
  }, [tickets, dateRange, filterOwner]);

  return (
    <div className="space-y-8 animate-in fade-in pb-20">
      
      {/* SECTION 1: TOP PERFORMERS (New!) */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rank 2 (Silver) */}
          <LeaderCard 
            rank={2} 
            data={topPerformers[1]} 
            color="from-slate-300 to-slate-400" 
            iconColor="text-slate-400"
            delay="100"
            isDark={isDark}
          />
          
          {/* Rank 1 (Gold - Bigger) */}
          <LeaderCard 
            rank={1} 
            data={topPerformers[0]} 
            color="from-amber-300 to-amber-500" 
            iconColor="text-amber-500"
            isCenter={true}
            delay="0"
            isDark={isDark}
          />

          {/* Rank 3 (Bronze) */}
          <LeaderCard 
            rank={3} 
            data={topPerformers[2]} 
            color="from-orange-300 to-orange-400" 
            iconColor="text-orange-400"
            delay="200"
            isDark={isDark}
          />
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
       {/* SECTION 2: ALERTS */}
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
                  <a href={`https://app.devrev.ai/works/${t.display_id}`} target="_blank" className="text-slate-300 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-all"><ExternalLink className="w-3 h-3" /></a>
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

// --- SUB-COMPONENT: Leader Card ---
const LeaderCard = ({ rank, data, color, iconColor, isCenter, delay, isDark }) => {
    if (!data) return (
        <div className={`h-40 rounded-xl border border-dashed flex flex-col items-center justify-center gap-2 ${isCenter ? 'lg:-mt-4 lg:h-44' : ''} ${isDark ? 'border-slate-800 bg-slate-900/50' : 'border-slate-200 bg-slate-50'}`}>
            <span className="text-xs text-slate-400 font-medium">No Data for Rank #{rank}</span>
        </div>
    );

    return (
        <div className={`relative flex flex-col items-center p-6 rounded-2xl shadow-sm border transition-all hover:shadow-md
            ${isCenter ? 'lg:-mt-6 lg:mb-6 lg:py-10 z-10 border-amber-200 dark:border-amber-900/30 bg-gradient-to-b from-amber-50/50 to-white dark:from-amber-900/10 dark:to-slate-900' : 'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800'}
            `}
            style={{ animationDelay: `${delay}ms` }}
        >
            {/* Crown for #1 */}
            {rank === 1 && <Crown className="w-8 h-8 text-amber-500 mb-2 animate-bounce" />}
            
            {/* Rank Badge */}
            <div className={`absolute top-4 right-4 w-8 h-8 flex items-center justify-center rounded-full font-bold text-white shadow-sm bg-gradient-to-br ${color}`}>
                {rank}
            </div>

            {/* Avatar / Initial */}
            <div className={`w-16 h-16 rounded-full flex items-center justify-center text-xl font-bold mb-3 shadow-inner
                 ${isDark ? 'bg-slate-800 text-slate-200' : 'bg-slate-100 text-slate-600'}`}>
                {data.name.charAt(0)}
            </div>

            <h3 className={`font-bold text-lg mb-1 ${isDark ? 'text-slate-100' : 'text-slate-800'}`}>{data.name}</h3>
            
            <div className="flex items-center gap-2 mb-3">
                 <div className="px-3 py-1 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 text-xs font-bold flex items-center gap-1">
                    <Smile className="w-3 h-3" /> {data.good} Good
                 </div>
            </div>

            <p className={`text-xs text-center ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
                Captured {Math.round((data.good / data.total) * 100)}% positive ratings from {data.total} tickets.
            </p>
        </div>
    )
}

const ChartCard = ({ title, icon: Icon, color, children, isDark }) => (
  <div className="bg-white dark:bg-slate-900 p-6 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm h-80 transition-colors">
    <h3 className={`text-xs font-bold text-slate-500 dark:text-slate-400 uppercase mb-6 flex items-center gap-2`}>
      <Icon className={`w-4 h-4 ${color}`} /> {title}
    </h3>
    <ResponsiveContainer width="100%" height="85%">{children}</ResponsiveContainer>
  </div>
);

export default AnalyticsDashboard;