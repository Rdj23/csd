import clevertap from "clevertap-web-sdk";

// Initialize only once
clevertap.init("R57-875-KK7Z"); // Replace 'us1' with your region if different

export const trackEvent = (eventName, eventProps = {}) => {
  try {
    clevertap.event.push(eventName, eventProps);
    console.log(`📊 Tracked: ${eventName}`, eventProps);
  } catch (e) {
    console.error("CT Error:", e);
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
    console.log(`👤 Logged in as: ${user.name}`);
  } catch (e) {
    console.error("CT Login Error:", e);
  }
};

export default clevertap;