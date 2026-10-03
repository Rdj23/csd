/**
 * Team configuration — who is on which team, and how we name them.
 *
 * MIRRORS backend/config/constants.js. These maps exist twice on purpose: the
 * frontend needs them to render filters and group tickets without a round
 * trip. When onboarding someone, BOTH copies must change — see the roster
 * onboarding checklist in docs/features/09-roster-backup.md.
 */

// --- TEAM CONFIGURATION ---
// Restructured 2026-09-08: six new L2 leads, each with their own Slack channel
// for the Attention Queue (channel IDs live backend-side only).
export const TEAM_GROUPS = {
  "Adarsh": { "DEVU-1076": "Adarsh", "DEVU-3225": "Zeel" },
  "Tamanna": { "DEVU-689": "Tamanna", "DEVU-3226": "Soham", "DEVU-1122": "Vaibhav" },
  "Musaveer": { "DEVU-736": "Musaveer", "DEVU-3261": "Viraj", "DEVU-1110": "Shreyas" },
  "Nikita": { "DEVU-4": "Nikita", "DEVU-1115": "Shreya" },
  "Shweta": { "DEVU-1113": "Shweta", "DEVU-1114": "Archie" },
  "Harsh": { "DEVU-1098": "Harsh", "DEVU-1072": "Neha", "DEVU-550": "Anurag" },
  "Adish": { "DEVU-1121": "Adish" }
};

export const TEAM_REGION_MAP = {
  "Adish": ["South America", "North America"]
};

// People with no team lead. Kept OUT of TEAM_GROUPS so no team is created for
// them, but still resolved for ticket ownership / name normalization — without
// an entry here their tickets silently drop out of every owner-filtered view.
// As of the 2026-09-08 restructure these are all ex-GST members whose history
// must stay readable. Move a DEVU-ID into a TEAM_GROUPS block if a lead is set.
export const TEAMLESS_MEMBERS = {
  "DEVU-1111": "Rohan",
  "DEVU-5": "Aditya",
  "DEVU-1102": "Debashish",
  "DEVU-2611": "Rishabh",
  "DEVU-1087": "Shubhankar",
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
