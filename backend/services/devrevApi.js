import axios from "axios";

export const DEVREV_API = "https://api.devrev.ai";

export const HEADERS = {
  Authorization: `Bearer ${process.env.VITE_DEVREV_PAT}`,
  "Content-Type": "application/json",
};

// Retry helper for individual API calls
export const fetchWithRetry = async (url, options, retries = 2) => {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await axios.get(url, options);
    } catch (err) {
      if (attempt === retries) throw err;
      console.warn(`⚠️ API attempt ${attempt}/${retries} failed: ${err.message}. Retrying in ${attempt * 2}s...`);
      await new Promise((r) => setTimeout(r, attempt * 2000));
    }
  }
};
