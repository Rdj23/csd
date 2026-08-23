import clevertap from "clevertap-web-sdk";

// Initialize only once — wrapped in try/catch because clearing browser
// cookies can leave the SDK in a broken state on first load
try {
  clevertap.init("R57-875-KK7Z");
} catch (e) {
  console.warn("CleverTap init failed (will retry on next page load):", e);
}

export const trackEvent = (eventName, eventProps = {}) => {
  try {
    clevertap.event.push(eventName, eventProps);
  } catch (e) {
    // silently ignore
  }
};

export const loginUser = (user) => {
  if (!user) return;
  try {
    clevertap.onUserLogin.push({
      "Site": {
        "Name": user.name,
        "Identity": user.email, // Unique ID
        "Email": user.email,
        // "User Type": "Support Engineer",
        // "Team": user.team // If you have this data
      }
    });
  } catch (e) {
    // silently ignore
  }
};

export default clevertap;