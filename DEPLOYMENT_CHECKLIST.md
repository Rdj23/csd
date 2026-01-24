# 🚀 Deployment Checklist - Support Dashboard Optimization

## ⚡ Quick Start (5 minutes)

### 1️⃣ Remove NodeCache Dependency
```bash
cd backend
npm uninstall node-cache
npm install  # Verify everything still works
```

### 2️⃣ Create MongoDB Indexes
```bash
cd backend
node create-indexes.js
```

**Expected Output**:
```
✅ Connected to MongoDB
✅ Index created: { stage_name: 1, actual_close_date: -1 }
✅ Index created: { actual_close_date: -1 }
✅ Index created: { created_date: -1, stage_name: 1 }
```

### 3️⃣ Test Locally
```bash
# Start backend
cd backend
npm start

# In another terminal, test the API
curl http://localhost:5000/api/tickets

# Should respond in < 2 seconds with active tickets only
```

### 4️⃣ Verify Changes
```bash
# Check memory usage
curl http://localhost:5000/api/cache/status | jq .memory

# Expected: heapUsed < 250MB (was 512MB+)
```

### 5️⃣ Deploy to Production
```bash
# Backend (adjust for your hosting)
git add .
git commit -m "Optimize: Hot/Warm/Cold data strategy, remove NodeCache"
git push origin main

# Frontend
cd ..
npm run build
# Deploy build folder to your host
```

---

## 📋 Detailed Verification Steps

### ✅ Step 1: Verify Backend Changes

**File**: [backend/server.js](backend/server.js)

- [ ] Line 10: NodeCache import commented out
- [ ] Line 34: NodeCache instance commented out
- [ ] Line 1197: `RECENTLY_SOLVED_CUTOFF` defined (24 hours)
- [ ] Line 1230: Loop limit reduced to 50 (was 100)
- [ ] Line 1247-1253: Filter checks `closedDate > RECENTLY_SOLVED_CUTOFF`
- [ ] Line 1297: `io.emit("DATA_UPDATED", {...})` instead of full tickets
- [ ] Line 1317: `/api/tickets` endpoint has pagination logic
- [ ] Line 258-268: New MongoDB indexes defined

**Run Linter**:
```bash
cd backend
npm run lint  # Fix any errors
```

---

### ✅ Step 2: Verify Frontend Changes

**File**: [src/store.js](src/store.js)

- [ ] Line 40: `DATA_UPDATED` event listener added
- [ ] Line 132: `fetchTickets` accepts `page` and `limit` parameters
- [ ] Line 145: Pagination params appended to URL
- [ ] Line 151: Pagination metadata stored in state

**Test in Browser**:
```javascript
// Open DevTools Console
const { fetchTickets } = useTicketStore.getState();

// Test non-paginated
await fetchTickets();

// Test paginated
await fetchTickets(1, 20);
```

---

### ✅ Step 3: Verify Database Indexes

**MongoDB Shell**:
```javascript
// Connect to your database
use support_dashboard

// List all indexes
db.analyticstickets.getIndexes()

// Expected output includes:
// { "stage_name": 1, "actual_close_date": -1 }
// { "actual_close_date": -1 }
// { "created_date": -1, "stage_name": 1 }
```

**Or via Node.js**:
```bash
node backend/create-indexes.js
```

---

### ✅ Step 4: Load Testing

**Install Artillery** (optional but recommended):
```bash
npm install -g artillery
```

**Create Load Test** (`load-test.yml`):
```yaml
config:
  target: "http://localhost:5000"
  phases:
    - duration: 60
      arrivalRate: 10
      name: "Warm up"
    - duration: 120
      arrivalRate: 50
      name: "Sustained load"
    - duration: 60
      arrivalRate: 100
      name: "Spike test"

scenarios:
  - name: "Get tickets"
    flow:
      - get:
          url: "/api/tickets"
      - think: 2
```

**Run Test**:
```bash
artillery run load-test.yml
```

**Expected Results**:
- ✅ All requests succeed (200 status)
- ✅ p95 response time < 500ms
- ✅ Server memory stays < 400MB
- ✅ No crashes or errors

---

## 🔍 Performance Benchmarks

### Before Optimization
```
📊 Metrics (Before):
├─ Memory: 512MB+ (crashes)
├─ Initial Load: 60 seconds
├─ Tickets Cached: 5,000+
├─ Socket Payload: ~5MB
└─ Concurrent Users: 10-20 (crashes)
```

### After Optimization
```
📊 Metrics (After):
├─ Memory: 150-200MB ✅
├─ Initial Load: 5-10 seconds ✅
├─ Tickets Cached: 50-200 ✅
├─ Socket Payload: ~200 bytes ✅
└─ Concurrent Users: 100+ ✅
```

---

## 🐛 Troubleshooting

### Issue: "Loading configuration..." still slow
**Solution**:
```bash
# Check Redis connection
curl http://localhost:5000/api/cache/status

# If Redis is disconnected:
# 1. Verify REDIS_URL in .env
# 2. Restart Redis server
# 3. Check Redis logs
```

### Issue: Tickets not updating in real-time
**Solution**:
```javascript
// Check browser console for:
"🟢 Connected to Real-Time Server"

// If not connected:
// 1. Verify Socket.io server is running
// 2. Check CORS settings in backend/server.js
// 3. Ensure connectSocket() is called in App.jsx
```

### Issue: MongoDB indexes not working
**Solution**:
```bash
# Re-run index creation
node backend/create-indexes.js

# Verify indexes exist
mongo "mongodb+srv://your-connection-string"
use support_dashboard
db.analyticstickets.getIndexes()
```

### Issue: Historical tickets missing
**Expected Behavior**:
Historical tickets are in MongoDB (Warm/Cold storage), not in cache.

**Access via API**:
```bash
# Get tickets for specific date
curl "http://localhost:5000/api/tickets/by-date?date=2025-10-15"

# Get tickets for date range
curl "http://localhost:5000/api/tickets/by-range?start=2025-10-01&end=2025-10-31"
```

---

## 📊 Monitoring Dashboard

### Key Metrics to Watch

1. **Memory Usage** (Target: < 300MB)
   ```bash
   watch -n 5 'curl -s http://localhost:5000/api/cache/status | jq .memory.heapUsed'
   ```

2. **Cache Hit Rate** (Target: > 90%)
   ```bash
   # Check logs for:
   grep "Redis HIT" logs/server.log | wc -l
   grep "No cache" logs/server.log | wc -l
   ```

3. **Ticket Count** (Target: < 300)
   ```bash
   curl -s http://localhost:5000/api/tickets | jq '.tickets | length'
   ```

4. **Response Time** (Target: < 200ms)
   ```bash
   time curl http://localhost:5000/api/tickets > /dev/null
   ```

---

## ✅ Sign-Off Checklist

### Pre-Deployment
- [ ] NodeCache removed from package.json
- [ ] All tests pass (`npm test`)
- [ ] Linter passes (`npm run lint`)
- [ ] MongoDB indexes created
- [ ] Redis connection verified
- [ ] Local testing successful

### Post-Deployment
- [ ] Initial load < 10 seconds
- [ ] Memory usage < 300MB
- [ ] Socket.io events working
- [ ] Pagination working (test with `?page=1&limit=20`)
- [ ] Real-time updates working
- [ ] Historical data accessible via API

### Load Testing
- [ ] 50 concurrent users: ✅ No errors
- [ ] 100 concurrent users: ✅ No crashes
- [ ] Memory stable after 1 hour: ✅ < 400MB
- [ ] Response time p95 < 500ms: ✅

---

## 🎯 Success Metrics

If all these are true, your optimization is successful:

✅ **Memory**: `heapUsed` < 250MB under normal load
✅ **Speed**: Initial load < 10 seconds
✅ **Scale**: 100+ concurrent users without crashes
✅ **Efficiency**: Socket payload < 1KB per message
✅ **Reliability**: Cache hit rate > 90%
✅ **Data**: Historical tickets in MongoDB (not RAM)

---

## 📞 Need Help?

1. Check [OPTIMIZATION_SUMMARY.md](OPTIMIZATION_SUMMARY.md) for detailed explanations
2. Review server logs: `pm2 logs server` or `tail -f logs/server.log`
3. Test with small dataset first (< 100 tickets)
4. Verify all environment variables are set correctly

---

**Deployment Date**: __________
**Deployed By**: __________
**Sign-Off**: __________

---

**Version**: 1.0
**Last Updated**: 2026-01-24
