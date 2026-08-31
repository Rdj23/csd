/**
 * Team configuration — who is on which team, and how we name them.
 *
 * MIRRORS backend/config/constants.js. These maps exist twice on purpose: the
 * frontend needs them to render filters and group tickets without a round
 * trip. When onboarding someone, BOTH copies must change — see the roster
 * onboarding checklist in docs/features/09-roster-backup.md.
 */

// --- TEAM CONFIGURATION ---
export const TEAM_GROUPS = {
  "Rohan": { "DEVU-1111": "Rohan", "DEVU-550": "Anurag", "DEVU-1115": "Shreya", "DEVU-1087": "Shubhankar" },
  "Shweta": { "DEVU-1113": "Shweta", "DEVU-1114": "Archie", "DEVU-736": "Musaveer" },
  "Harsh": { "DEVU-1098": "Harsh", "DEVU-1072": "Neha", "DEVU-1122": "Vaibhav" },
  "Aditya": { "DEVU-5": "Aditya", "DEVU-2611": "Rishabh", "DEVU-4": "Nikita", "DEVU-1110": "Shreyas" },
  "Debashish": { "DEVU-1102": "Debashish", "DEVU-1076": "Adarsh", "DEVU-689": "Tamanna" },
  "Adish": { "DEVU-1121": "Adish" }
};

export const TEAM_REGION_MAP = {
  "Adish": ["South America", "North America"]
};

// GST members not (yet) under a team lead. They resolve for ticket ownership /
// name normalization but are deliberately kept OUT of TEAM_GROUPS so no team is
// created for them — they only populate individual/member views. Move a DEVU-ID
// into a TEAM_GROUPS block above once the person is assigned a lead.
export const TEAMLESS_MEMBERS = {
  "DEVU-3225": "Zeel",
  "DEVU-3226": "Soham",
  "DEVU-3261": "Viraj",
};

export const FLAT_TEAM_MAP = {
  ...Object.values(TEAM_GROUPS).reduce((acc, group) => ({ ...acc, ...group }), {}),
  ...TEAMLESS_MEMBERS,
};

// Map email addresses to GST names
export const EMAIL_TO_NAME_MAP = {
  "rohan.jadhav@clevertap.com": "Rohan",
  "archie@clevertap.com": "Archie",
  "neha.yadav@clevertap.com": "Neha",
  "shreya.khale@clevertap.com": "Shreya",
  "vaibhav.agarwal@clevertap.com": "Vaibhav",
  "adarsh.dubey@clevertap.com": "Adarsh",
  "shubhankar@clevertap.com": "Shubhankar",
  "musaveer@clevertap.com": "Musaveer",
  "anurag.ghatge@clevertap.com": "Anurag",
  "debashish@clevertap.com": "Debashish",
  "aditya.mishra@clevertap.com": "Aditya",
  "shweta.more@clevertap.com": "Shweta",
  "nikita.narwani@clevertap.com": "Nikita",
  "harsh.singh@clevertap.com": "Harsh",
  "rishabh.j@clevertap.com": "Rishabh",
  "tamanna@clevertap.com": "Tamanna",
  "shreyas.naikwadi@clevertap.com": "Shreyas",
  "adish@clevertap.com": "Adish",
  "zeel@clevertap.com": "Zeel",
  "soham@clevertap.com": "Soham",
  "viraj.walavalkar@clevertap.com": "Viraj",
};
