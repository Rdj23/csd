// Tickets solved before this date are historical backfill — no Slack alerts during sync.
// After this date, all "Understanding Gap - CS" tickets from GST reporters trigger alerts.
export const BACKFILL_CUTOFF = new Date("2026-02-20");

// --- TEAM CONFIGURATION (Backend Copy) ---
export const TEAM_GROUPS = {
  "Mashnu": { "DEVU-1111": "Rohan", "DEVU-1114": "Archie", "DEVU-1072": "Neha", "DEVU-1115": "Shreya", "DEVU-1122": "Vaibhav", "DEVU-1076": "Adarsh", "DEVU-1108": "Abhishek" },
  "Debashish": { "DEVU-1087": "Shubhankar", "DEVU-736": "Musaveer", "DEVU-550": "Anurag", "DEVU-1102": "Debashish" },
  "Shweta": { "DEVU-5": "Aditya", "DEVU-1113": "Shweta", "DEVU-4": "Nikita" },
  "Tuaha": { "DEVU-1123": "Tuaha Khan", "DEVU-1098": "Harsh", "DEVU-689": "Tamanna", "DEVU-1110": "Shreyas" },
  "Adish": { "DEVU-1121": "Adish" }
};

export const GST_NAME_MAP = {
  Rohan: "Rohan",
  "Rohan Jadhav": "Rohan",
  Archie: "Archie",
  "Neha Yadav": "Neha",
  Neha: "Neha",
  "Shreya Khale": "Shreya",
  "Vaibhav Agarwal": "Vaibhav",
  Adarsh: "Adarsh",
  "Abhishek Vishwakarma": "Abhishek",
  Shubhankar: "Shubhankar",
  "Musaveer Manekia": "Musaveer",
  "Debashish Muni": "Debashish",
  "Shweta.M": "Shweta",
  "Anurag Ghatge": "Anurag",
  "nikita-narwani": "Nikita",
  "Aditya Mishra": "Aditya",
  "Taha Khan": "Tuaha Khan",
  "Harsh Singh": "Harsh",
  "Tamanna Khan": "Tamanna",
  Tamanna: "Tamanna",
  Shreyas: "Shreyas",
  "Shreyas Naikwadi": "Shreyas",
};

// List of valid GST members
export const GST_MEMBERS = new Set([
  "Rohan",
  "Archie",
  "Neha",
  "Shreya",
  "Vaibhav",
  "Adarsh",
  "Abhishek",
  "Shubhankar",
  "Musaveer",
  "Anurag",
  "Debashish",
  "Aditya",
  "Shweta",
  "Nikita",
  "Tuaha Khan",
  "Harsh",
  "Tamanna",
  "Shreyas",
  "Adish",
]);

// Shift timings in IST (decimal hours: 7.5 = 7:30 AM)
export const SHIFT_HOURS = {
  "SHIFT 1": { start: 7.5, end: 16.5 },   // 7:30 AM - 4:30 PM
  "SHIFT 2": { start: 10.5, end: 19.5 },  // 10:30 AM - 7:30 PM
  "SHIFT 3": { start: 13.5, end: 22.5 },  // 1:30 PM - 10:30 PM
  "SHIFT 4": { start: 22.5, end: 7.5, overnight: true }, // 10:30 PM - 7:30 AM
  "ON CALL": { start: 0, end: 24 },
};

// Off status reasons with friendly display names
export const OFF_STATUS_MAP = {
  "WEEK OFF": "Week Off",
  "WO": "Week Off",
  "EL": "On Leave (EL)",
  "NH": "National Holiday",
  "PL": "Planned Leave",
  "PH": "Public Holiday",
  "L": "On Leave",
  "COMP OFF": "Comp Off",
  "OH": "Optional Holiday",
  "": "Away",
};
export const OFF_STATUSES = Object.keys(OFF_STATUS_MAP);

// L1/L2 designation mapping
export const DESIGNATION_MAP = {
  "Debashish": "L2", "Anurag": "L1", "Musaveer": "L1", "Shubhankar": "L1",
  "Tuaha Khan": "L2", "Tuaha": "L2", "Harsh": "L2", "Tamanna": "L1", "Shreyas": "L1",
  "Shweta": "L2", "Aditya": "L2", "Nikita": "L1",
  "Rohan": "L2", "Archie": "L1", "Neha": "L1", "Shreya": "L1",
  "Abhishek": "L1", "Adarsh": "L1", "Vaibhav": "L1", "Adish": "L2",
};

// Map display names to roster names (for names that differ)
export const NAME_TO_ROSTER_MAP = {
  "Tuaha Khan": "Tuaha",
};

// Team mapping for backup lookups
export const TEAM_MAPPING = {
  "Debashish": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },
  "Anurag": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },
  "Musaveer": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },
  "Shubhankar": { team: "Debashish", members: ["Debashish", "Anurag", "Musaveer", "Shubhankar"] },

  "Tuaha Khan": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Tuaha": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Harsh": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Tamanna": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },
  "Shreyas": { team: "Tuaha", members: ["Tuaha Khan", "Harsh", "Tamanna", "Shreyas"] },

  "Shweta": { team: "Shweta", members: ["Shweta", "Aditya", "Nikita"] },
  "Aditya": { team: "Shweta", members: ["Shweta", "Aditya", "Nikita"] },
  "Nikita": { team: "Shweta", members: ["Shweta", "Aditya", "Nikita"] },

  "Rohan": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Archie": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Neha": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Shreya": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Abhishek": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Adarsh": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
  "Vaibhav": { team: "Mashnu", members: ["Rohan", "Archie", "Neha", "Shreya", "Abhishek", "Adarsh", "Vaibhav"] },
};

// --- SLACK ALERT CONFIGURATION ---
export const SLACK_ADMIN_ID = "<@U06G06YQR6E>"; // Tuaha Khan - Admin to notify

export const GST_SLACK_MEMBER_IDS = {
  "Tuaha Khan": "<@U06G06YQR6E>",
  "Mashnu Kanurkar": "<@U02QSTABJ1Y>",
  "Adish Gaikwad": "<@U03F46V6DLP>",
  "Debashish Muni": "<@U05HCEX0M3N>",
  "Shweta More": "<@U03GEG1D6HK>",
  "Unnati Rawal": "<@U05PCDP5J3S>",
  "Harsh Singh": "<@U087F8FEY04>",
  "Tamanna Khan": "<@U06BKN9AP0A>",
  "Adarsh Dubey": "<@U078D2NRPTM>",
  "Aditya Mishra": "<@U07AYMGV4G7>",
  "Anurag Ghatge": "<@U078FL0R57E>",
  "Archie Bajaj": "<@U06FX94R7NH>",
  "Musaveer Manekia": "<@U0864UQL50V>",
  "Neha Yadav": "<@U06GP0FB06L>",
  "Nikita Narwani": "<@U078D2P1FV1>",
  "Rohan Jadhav": "<@U080N75F9GR>",
  "Shreya Khale": "<@U0786GU2SDU>",
  "Shubhankar Bhattacharya": "<@U078RRJRA9F>",
  "Abhinav Srivastav": "<@U095564QECA>",
  "Shreyas Naikwadi": "<@U095JJM3X97>",
  "Vaibhav Agarwal": "<@U095434R8NR>",
  "Abhishek Vishwakarma": "<@U095437RPKP>",
};

// Team mapping for gamification display
export const GAMIFICATION_TEAM_MAP = {
  "Debashish": "Debashish", "Anurag": "Debashish", "Musaveer": "Debashish", "Shubhankar": "Debashish",
  "Tuaha Khan": "Tuaha", "Harsh": "Tuaha", "Tamanna": "Tuaha", "Shreyas": "Tuaha",
  "Shweta": "Shweta", "Aditya": "Shweta", "Nikita": "Shweta",
  "Rohan": "Mashnu", "Archie": "Mashnu", "Neha": "Mashnu", "Shreya": "Mashnu",
  "Abhishek": "Mashnu", "Adarsh": "Mashnu", "Vaibhav": "Mashnu", "Adish": "Adish",
};

// Email to GST name mapping (for my-stats endpoint)
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
  "debashish@clevertap.com": "Debashish",
  "aditya.mishra@clevertap.com": "Aditya",
  "shweta.more@clevertap.com": "Shweta",
  "nikita.narwani@clevertap.com": "Nikita",
  "mohammed.khan@clevertap.com": "Tuaha Khan",
  "harsh.singh@clevertap.com": "Harsh",
  "tamanna@clevertap.com": "Tamanna",
  "shreyas.naikwadi@clevertap.com": "Shreyas",
  "adish@clevertap.com": "Adish",
};

// Flat DEVU-ID → GST name mapping (built from TEAM_GROUPS)
export const GST_DEVU_MAP = {};
for (const members of Object.values(TEAM_GROUPS)) {
  for (const [devuId, name] of Object.entries(members)) {
    GST_DEVU_MAP[devuId] = name;
  }
}

// Helper functions
export const resolveOwnerName = (displayName) => {
  if (!displayName) return null;
  const resolved = GST_NAME_MAP[displayName];
  if (resolved && GST_MEMBERS.has(resolved)) return resolved;
  return null;
};

export const isGSTMember = (ownerName) => {
  if (!ownerName) return false;
  return GST_MEMBERS.has(ownerName);
};

// Helper to get current IST time (handles server running in UTC)
export const getISTTime = () => {
  const now = new Date();
  const istOffset = 5.5 * 60 * 60 * 1000;
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60 * 1000);
  return new Date(utcTime + istOffset);
};

// Helper to get current hour in IST as decimal
export const getCurrentISTHour = () => {
  const ist = getISTTime();
  return ist.getHours() + ist.getMinutes() / 60;
};

export const getQuarterDateRange = (quarter) => {
  const now = new Date();
  switch (quarter) {

    case "Q1_26":
      return {
        start: new Date("2026-01-01"),
        end: new Date("2026-03-31T23:59:59Z"),
      };

    case "Q1_26_W1":
      return {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-04T23:59:59Z"),
      };
    case "Q1_26_W2":
      return {
        start: new Date("2026-01-05"),
        end: new Date("2026-01-11T23:59:59Z"),
      };
    case "Q1_26_W3":
      return {
        start: new Date("2026-01-12"),
        end: new Date("2026-01-18T23:59:59Z"),
      };
    case "Q1_26_W4":
      return {
        start: new Date("2026-01-19"),
        end: new Date("2026-01-25T23:59:59Z"),
      };
    case "Q1_26_W5":
      return {
        start: new Date("2026-01-26"),
        end: new Date("2026-02-01T23:59:59Z"),
      };
    case "Q1_26_W6":
      return {
        start: new Date("2026-02-02"),
        end: new Date("2026-02-08T23:59:59Z"),
      };
    case "Q1_26_W7":
      return {
        start: new Date("2026-02-09"),
        end: new Date("2026-02-15T23:59:59Z"),
      };
    case "Q1_26_W8":
      return {
        start: new Date("2026-02-16"),
        end: new Date("2026-02-22T23:59:59Z"),
      };
    case "Q1_26_W9":
      return {
        start: new Date("2026-02-23"),
        end: new Date("2026-03-01T23:59:59Z"),
      };
    case "Q1_26_W10":
      return {
        start: new Date("2026-03-02"),
        end: new Date("2026-03-08T23:59:59Z"),
      };
    case "Q1_26_W11":
      return {
        start: new Date("2026-03-09"),
        end: new Date("2026-03-15T23:59:59Z"),
      };
    case "Q1_26_W12":
      return {
        start: new Date("2026-03-16"),
        end: new Date("2026-03-22T23:59:59Z"),
      };
    case "Q1_26_W13":
      return {
        start: new Date("2026-03-23"),
        end: new Date("2026-03-31T23:59:59Z"),
      };

    // Q1 2026 Months
    case "Q1_26_M1":
      return {
        start: new Date("2026-01-01"),
        end: new Date("2026-01-31T23:59:59Z"),
      };
    case "Q1_26_M2":
      return {
        start: new Date("2026-02-01"),
        end: new Date("2026-02-28T23:59:59Z"),
      };
    case "Q1_26_M3":
      return {
        start: new Date("2026-03-01"),
        end: new Date("2026-03-31T23:59:59Z"),
      };

    default:
      // Default to last 60 days
      const start = new Date(now);
      start.setDate(start.getDate() - 60);
      return { start, end: now };
  }
};
