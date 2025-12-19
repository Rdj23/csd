import clevertap from "clevertap-web-sdk";

// Initialize only once
clevertap.init("R57-875-KK7Z"); // Replace 'us1' with your region if different

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