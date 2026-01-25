# 📚 Customer Success Dashboard - Internal User Guide

## 🎯 Quick Start

**Dashboard URL:** [Your Production URL]

**Expected Load Times:**
- **First access of the day:** 30-60 seconds (server cold start)
- **After first load:** 2-5 seconds
- **During business hours (9 AM - 6 PM IST):** Usually warm, loads in 5-10 seconds

---

## ⚡ Why Is It Slow Sometimes?

This dashboard runs on **Render's free tier** to keep costs at zero. Here's what happens behind the scenes:

### Normal Behavior (NOT a bug):

1. **15-minute inactivity spindown**
   - If nobody uses the dashboard for 15 minutes, Render puts the server to sleep
   - Next person to access needs to wait 30-60 seconds while it wakes up

2. **Cold start sequence**
   - Server container starts (~15s)
   - MongoDB connects (~5s)
   - Redis connects (~5s)
   - Data caches load (~10-20s)
   - **Total: 35-60 seconds**

3. **After that:** Everything runs at full speed (2-5s load times)

---

## ✅ What We've Done to Optimize

### Automated Keepalive (ToS-Compliant)
- Server pings **4 times daily** during business hours:
  - 9 AM, 12 PM, 3 PM, 6 PM IST
- This keeps it warm during peak usage without violating Render's Terms of Service

### Smart Retry Logic
- Frontend automatically retries up to 6 times with intelligent backoff
- You'll see status updates: "Waking up server..." → "Almost there..." → "Connected!"

### Background Loading
- Server starts accepting requests immediately
- Heavy tasks (roster sync, data caching) run in the background

---

## 📋 Best Practices for Internal Users

### 1. **Plan Your Work**
If you know you'll need the dashboard, open it **5 minutes before** your meeting or task. Let it load in the background.

### 2. **Keep a Tab Open**
If you're actively using it, keep the browser tab open. This prevents the 15-minute timeout.

### 3. **Expect Delays During These Times:**
- **First thing in the morning** (before 9 AM IST)
- **After lunch** (if unused 12-3 PM)
- **Late evening** (after 6 PM)

### 4. **Don't Panic on Slow Load**
The loading screen will tell you:
- ✅ "Waking up server..." = Normal cold start (wait 30-60s)
- ⚠️ "Almost there..." = Server is responding, almost ready
- ❌ "Unable to Connect" = Actual error (rare, click "Try Again")

---

## 🚨 When to Report Issues

**REPORT if:**
- ❌ Error message after multiple retries
- ❌ Dashboard completely down for >5 minutes
- ❌ Data not loading even after login succeeds
- ❌ Features broken (filters, exports, analytics)

**DON'T REPORT if:**
- ✅ First load takes 30-60 seconds (expected behavior)
- ✅ "Waking up server" message appears (normal cold start)
- ✅ Slow load between 9 AM - 6 PM after 15 min inactivity

---

## 🔍 Troubleshooting

### "It's taking too long to load"
**Solution:** Wait up to 60 seconds. The retry logic will handle it automatically.

### "I got an error after waiting"
**Solution:** Click the "Try Again" button. If it fails twice, contact IT/Admin.

### "It was working, now it's slow again"
**Solution:** Likely a cold start. You probably didn't use it for 15+ minutes. Wait 30-60s.

---

## 📊 Usage Recommendations by Role

### **CSMs / TAMs**
- Open dashboard at **start of day** (let it warm up)
- Keep tab pinned during work hours
- Refresh data manually with "Sync" button when needed

### **Team Leads**
- Access dashboard **before standups/1:1s**
- Use "My Views" to save common filter combinations
- Export CSVs for weekly reviews

### **Admins**
- Monitor server health at `/api/health` endpoint
- Review GitHub Actions logs for keepalive status
- Check cold start metrics in health endpoint

---

## 🛡️ Why We're NOT Upgrading (Yet)

**Current Setup:**
- **Cost:** $0/month
- **Reliability:** 99% uptime (with expected cold starts)
- **Performance:** Fast once warmed up

**Paid Tier ($7/month) Would Give:**
- ✅ No cold starts
- ✅ Always-on server
- ✅ Sub-5-second loads 24/7

**Decision:** For internal use with <20 users, free tier is sufficient. We've optimized as much as possible without violating ToS.

---

## 📞 Support

**For technical issues:** [Your IT Contact]
**For feature requests:** [Product/Engineering Contact]

**Server Status Monitoring:**
```bash
# Check server health (for admins)
curl https://your-backend-url.onrender.com/api/health
```

---

## 🔄 Changelog

**Latest Optimizations (Jan 2026):**
- ✅ Reduced cold start wait with non-blocking connections
- ✅ Added smart retry logic (6 attempts with backoff)
- ✅ Implemented ToS-compliant keepalive (4x daily)
- ✅ Enhanced loading UI with progress indicators
- ✅ Added server health monitoring

---

## 💡 Pro Tips

1. **Bookmark the dashboard** for quick access
2. **Use Cmd/Ctrl + R** to refresh if it feels slow (sometimes browser cache helps)
3. **Clear filters** if ticket list feels sluggish (use the "X" buttons)
4. **Export to CSV** for offline analysis (reduces server load)

---

**Remember:** 30-60 seconds of patience on first load = $0 hosting costs. Worth it! 🎉
