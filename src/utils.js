import { AlertOctagon, AlertTriangle, CheckCircle, Smile, Frown } from "lucide-react";
import { differenceInHours, differenceInMinutes, parseISO,differenceInDays } from "date-fns";
// --- TEAM CONFIGURATION ---
export const TEAM_GROUPS = {
  "Mashnu": { "DEVU-1111": "Rohan", "DEVU-1114": "Archie", "DEVU-1072": "Neha", "DEVU-1115": "Shreya", "DEVU-1122": "Vaibhav", "DEVU-1076": "Adarsh", "DEVU-1108": "Abhishek" },
  "Debashish": { "DEVU-1087": "Shubhankar", "DEVU-736": "Musaveer", "DEVU-550": "Anurag", "DEVU-1102": "Debashish" },
  "Shweta": { "DEVU-5": "Aditya", "DEVU-1113": "Shweta", "DEVU-4": "Nikita" },
  "Tuaha": { "DEVU-1123": "Tuaha Khan", "DEVU-1098": "Harsh", "DEVU-689": "Tamanna", "DEVU-1110": "Shreyas" },
  "Adish": { "DEVU-1121": "Adish" } 
};

export const TEAM_REGION_MAP = {
  "Adish": ["South America", "North America"]
};

// export const TEAM_LEADS = {
//   "Adish": {
//     devuId: "DEVU-1121",
//     email: "adish@clevertap.com",
//     regions: ["South America", "North America"],
//   }
// };
export const FLAT_TEAM_MAP = Object.values(TEAM_GROUPS).reduce((acc, group) => ({ ...acc, ...group }), {});

// Map email addresses to GST names
export const EMAIL_TO_NAME_MAP = {
  "rohan.jadhav@clevertap.com": "Rohan",
  "archie@clevertap.com": "Archie",
  "neha.yadav@clevertap.com": "Neha",
  "shreya.khale@clevertap.com": "Shreya",
  "vaibhav.agarwal@clevertap.com": "Vaibhav",
  "adarsh.dubey@clevertap.com": "Adarsh",
  "abhishek.vishwakarma@clevertap.com": "Abhishek",
  "shubhankar@clevertap.com": "Shubhankar",
  "musaveer@clevertap.com": "Musaveer",
  "anurag.ghatge@clevertap.com": "Anurag",
  "debashish.muni@clevertap.com": "Debashish",
  "aditya.mishra@clevertap.com": "Aditya",
  "shweta.more@clevertap.com": "Shweta",
  "nikita.narwani@clevertap.com": "Nikita",
  "mohammed.khan@clevertap.com": "Tuaha Khan",
  "harsh.singh@clevertap.com": "Harsh",
  "tamanna@clevertap.com": "Tamanna",
  "shreyas.naikwadi@clevertap.com": "Shreyas",
  "adish@clevertap.com": "Adish",
};

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
  // if (t.sentiment) {
  //   if (t.sentiment.id === 2 || t.sentiment.label === "Happy") return "Good";
  //   if (t.sentiment.id === 1 || t.sentiment.label === "Sad" || t.sentiment.label === "Bad") return "Bad";
  // }
  const oldRating = Number(t.custom_fields?.tnt__csatrating);
  if (oldRating === 2) return "Good";
  if (oldRating === 1) return "Bad";
  return null;
};

export const formatRWT = (epoch) => {
  if (!epoch) return 0;
  return Math.max(0, Date.now() - (epoch * 1000));
};

