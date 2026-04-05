# GST Gamification Rules

A simple guide to how the leaderboard scores are calculated.

---

## The 6 Metrics We Track

| # | Metric | What It Means | Good Performance |
|---|--------|--------------|------------------|
| 1 | **Productivity** | Tickets solved per working day | Higher is better |
| 2 | **CSAT %** | % of customer ratings that are positive | Higher is better |
| 3 | **Positive CSATs** | Total count of positive customer ratings | Higher is better |
| 4 | **Avg RWT** | Average hours a customer waits for a response | Lower is better |
| 5 | **Avg Iterations** | Average back-and-forth exchanges per ticket | Lower is better |
| 6 | **FRR %** | % of tickets resolved in the first response | Higher is better |

---

## How the Final Score Works

### Step 1: Compare Within Your Group

Each person is compared **only against others in their group** (L1 vs L1, L2 vs L2). We convert each metric into a 0-100 scale based on where you stand between the lowest and highest in your group.

**Example:** If the best productivity in L1 is 6.0/day and the lowest is 3.0/day, someone at 4.5/day scores 50% on productivity (they're halfway between worst and best).

### Step 2: Apply Weights

Each metric contributes a specific percentage to your final score:

| Metric | Weight |
|--------|--------|
| Productivity | **30%** |
| CSAT % | **15%** |
| Positive CSATs | **10%** |
| Avg RWT | **15%** |
| Avg Iterations | **15%** |
| FRR % | **15%** |
| **Total** | **100%** |

Weights are the same for both L1 and L2.

**Productivity carries the most weight (30%)**, but quality metrics (RWT + Iterations + FRR) together account for **45%**. This means consistently good quality can outweigh raw ticket volume.

### Step 3: Rank

Engineers are ranked by their final weighted score (highest first). If two people tie, they are sorted alphabetically.

---

## What Counts and What Doesn't

### Tickets That Count
- All solved/closed tickets assigned to the engineer
- Tickets within the selected quarter's date range

### Tickets That Are Excluded
- **NOC tickets** are excluded from: Solved count, Productivity, RWT, Iterations, and FRR
- **NOC tickets ARE included** in CSAT % and Positive CSAT count (customer satisfaction always matters)

### Other Exclusions
- Tickets with **zero RWT** are excluded from the RWT average (no data to average)
- Tickets with **zero iterations** are excluded from the Iterations average
- Tickets with **no owner** are excluded entirely

---

## Activity Points (Co-op System)

Engineers earn bonus points for **helping on other people's tickets** (co-op). Points are awarded only when:

1. The comment is **customer-facing** (not an internal note)
2. The engineer is commenting on **someone else's ticket** (not their own)
3. The ticket has been **solved or closed**

| Account Type | Points Per Comment |
|---|---|
| Key / Strategic accounts | 2 points |
| All other accounts | 4 points |

Internal comments and comments on your own tickets earn **zero points**.

---

## Quick Reference: How to Improve Your Score

| To improve... | Focus on... |
|---|---|
| Productivity (30%) | Solve more tickets per working day |
| CSAT % (15%) | Ensure customer satisfaction on every interaction |
| Positive CSATs (10%) | Encourage customers to leave positive feedback |
| Avg RWT (15%) | Respond to customers faster |
| Avg Iterations (15%) | Resolve issues with fewer back-and-forth messages |
| FRR % (15%) | Try to resolve tickets in your very first response |

---

## Percentile Display

The percentile shown on the leaderboard cards (e.g., "100% Final Percentile") tells you where you stand relative to your group:

- **100%** = You are ranked #1
- **50%** = You are in the middle
- Formula: `((Total people - Your rank + 1) / Total people) x 100`
