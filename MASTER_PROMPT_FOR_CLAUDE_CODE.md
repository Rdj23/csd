# COPY-PASTE THIS INTO CLAUDE CODE
## Dashboard Enterprise Refinement Prompt

```
DASHBOARD REFINEMENT: COMPLETE ENTERPRISE-PREMIUM POLISH

PROJECT: DevRev Customer Success Dashboard (Internal Support Ticket Review)

PRIORITY: Refine the ENTIRE dashboard to enterprise-premium quality (Apple-like: minimal, professional, polished)

USERS: Support staff, CSM/TAM teams, regional heads, leadership

DESIGN SYSTEM: Read DESIGN_SYSTEM.md - apply ALL values to this refinement.

---

REFINEMENT SCOPE - ALL FEATURES:

1. Ongoing Tickets
2. All Tickets
3. CSD Highlighted  
4. My Views
5. Analytics (with charts, graphs, NPS, CSAT)
6. Gamification (achievements, leaderboard)

---

REFINEMENT CHECKLIST - APPLY TO EVERY COMPONENT:

✅ SPACING
- Card padding: 16px (always)
- Section gaps: 24px (always)
- Component gaps: 8px (always)
- Button padding: 10px 18px (always)
- Table cell padding: 12px horizontal, 8px vertical
- NO random spacing values

✅ COLOR
- Use ONLY colors from DESIGN_SYSTEM.md
- Primary button: #0066CC
- Success badges: #34C759
- Warning badges: #FF9500
- Danger badges: #FF3B30
- Gamification/Scores: #FF6B35 (warm orange - must POP)
- Text: --text-primary / --text-secondary / --text-tertiary
- Backgrounds: --bg-primary / --bg-secondary / --bg-tertiary
- Borders: --border / --border-subtle

✅ TYPOGRAPHY
- Font: Inter (system fonts fallback)
- Sizes ONLY: 32px, 28px, 24px, 20px, 18px, 14px, 12px
- Weights ONLY: 400, 500, 600, 700
- Letter-spacing: -0.5px (headlines), 0px (body), 0.5px (labels)
- Metric values: 32px / 700 weight / monospace font
- Metric titles: 12px / 500 weight

✅ BORDERS & SHADOWS
- Card borders: 1px solid --border (very subtle)
- Card shadows: 0 1px 3px rgba(0,0,0,0.05) light / rgba(0,0,0,0.15) dark
- Hover lift: 0 4px 12px rgba(0,0,0,0.08) + translateY(-1px)
- Radius: 8px (buttons/inputs), 12px (cards/charts)
- NO thick borders, NO harsh shadows

✅ INTERACTIONS
- All transitions: 150ms ease-out
- Hover states: subtle (background shift, shadow lift, opacity change)
- Active states: clear (color change, border emphasis)
- NO instant (0ms) changes, NO bouncy animations

✅ LIGHT & DARK MODE
- Apply both color palettes from DESIGN_SYSTEM.md
- Same spacing/typography/structure in both
- Colors swap only, never layout changes
- Contrast verified: minimum 4.5:1 for text, 3:1 for UI elements

✅ ACCESSIBILITY
- Minimum font size: 12px
- Minimum contrast: 4.5:1 for text
- Focus states visible
- Keyboard navigation supported
- Color not relied upon alone (use icons)

---

DETAILED FEATURE SPECIFICATIONS:

FEATURE 1: NAVIGATION TABS
- Font: 14px / 500 (Body Medium)
- Inactive: --text-secondary color
- Active: --text-primary color + 2px border-bottom --primary (#0066CC)
- Padding: 12px 16px each tab
- Transition: 150ms
- Hover (inactive): background --bg-secondary, smooth 100ms

FEATURE 2: METRIC CARDS (Big numbers: 399, 136, 350, etc)
- Container: --bg-primary background, 1px --border border, 12px radius, 0 1px 3px shadow
- Padding: 20px (generous)
- Title (e.g., "HEALTHY (< 10 DAYS)"): 12px / 500 / --text-secondary
- Value (e.g., "399"): 32px / 700 / monospace font / --text-primary / line-height 40px
- Trend (if present): 14px / 500 / --success (up) or --danger (down)
- Icon: 16px / --text-secondary / right-aligned
- Hover: shadow 0 4px 12px, translateY(-1px), 150ms

FEATURE 3: FILTER BUTTONS (All Time, Team, Member, etc)
- Group gap: 8px
- Inactive button: --bg-secondary bg, --border border, --text-primary text
- Active button: --primary bg, white text, same border
- Height: 36px, Padding: 8px 12px, Radius: 8px, Font: 12px / 500
- Hover: --bg-tertiary (inactive) or --primary-hover (active)
- Transition: 150ms

FEATURE 4: PRIMARY BUTTONS (Save View, Filter, etc)
- Height: 36px
- Padding: 10px 18px
- Background: --primary (#0066CC)
- Text: white (#FFFFFF), 14px / 500
- Border-radius: 8px
- Shadow: none
- Hover: background --primary-hover (#0052A3)
- Active: background --primary-active (#003D7A) + scale 0.98
- Transition: 150ms

FEATURE 5: DATA TABLE (Ticket list)
- Container: border 1px --border, radius 12px, overflow auto
- Header: --bg-secondary background, 12px / 500 text, --text-secondary color, uppercase, letter-spacing 0.5px
- Header padding: 12px horizontal / 8px vertical
- Data rows: --bg-primary, 14px / 400, --text-primary
- Row padding: 12px horizontal / 8px vertical
- Row bottom border: 1px --border-subtle
- Row hover: background --bg-secondary, transition 100ms
- Ticket ID: monospace, --primary color (link style)
- Numbers: monospace font (precise appearance)

FEATURE 6: STATUS BADGES
- Success badge: --success-light bg (#E8F5E9), --success text (#34C759)
- Warning badge: --warning-light bg (#FEF3E2), --warning text (#FF9500)
- Danger badge: --danger-light bg (#FFEBEE), --danger text (#FF3B30)
- All badges: padding 4px 8px, radius 6px, font 12px / 500

FEATURE 7: PIE CHARTS (Open, Pending, On Hold, Solved breakdowns)
- Container: border 1px --border, radius 12px, padding 16px, shadow 0 1px 3px
- Title: 18px / 600, --text-primary
- Pie colors ONLY: #0066CC (primary), #FF6B35 (accent), #34C759 (success), #FF9500 (warning), --text-secondary (muted)
- No gradients, no decorations
- Legend: 12px / 400, --text-secondary, gap 12px
- Tooltip: --bg-secondary bg, 12px text, padding 4px 8px, shadow subtle
- Hover: segment opacity increases, 100ms transition

FEATURE 8: ANALYTICS CHARTS (Line, area, bar)
- Container: border 1px, radius 12px, padding 16px, height 200px+
- Grid lines: --border-subtle at 40% opacity
- Axes labels: 12px / 400, --text-secondary
- Colors: #0066CC (primary), #34C759 (success), #FF9500 (warning), --text-secondary (muted)
- Line width: 2px, no fill (clean)
- Legend: below, 12px / 400, gap 12px
- Tooltip: --bg-secondary, 12px, padding 8px 12px, shadow, transition 100ms

FEATURE 9: CSAT CHAMPIONS LEADERBOARD
- Container: border 1px, radius 12px, padding 16px, shadow 0 1px 3px
- Title: 18px / 600, --text-primary
- Row padding: 12px 16px, border-bottom 1px --border-subtle
- Rank: monospace, 14px / 500, --text-secondary (muted), centered
- Rank medals (1-3): 🥇🥈🥉 20px, centered
- Name: 14px / 500, --text-primary, flex 1
- Score: 14px / 700, --accent (#FF6B35) ← WARM ORANGE - MUST POP & CELEBRATE!
- Badge icon: 20px, right-aligned
- Row hover: background --bg-secondary, transition 100ms

FEATURE 10: ACHIEVEMENT BADGES (Medals, stars, trophies)
- Container: 80px x 80px square card
- Background: --accent-light (#FEF0E8)
- Border: 2px --accent (#FF6B35)
- Radius: 12px
- Padding: 8px
- Shadow: 0 1px 3px
- Icon: 48px, centered, --accent color
- Label: 12px / 600, --accent, centered below
- Hover: shadow 0 4px 12px, scale 1.05, transition 150ms
- Layout: grid 3-4 per row, gap 16px, responsive

FEATURE 11: NEGATIVE FEEDBACK SECTION
- Container: border 1px --danger at 50%, radius 12px, padding 16px
- Background: --danger-light (#FFEBEE)
- Shadow: 0 1px 3px rgba(255, 59, 48, 0.1)
- Title: 18px / 600 --danger, icon ⚠️ 20px
- Items: 14px / 400, --text-primary, icon 🔔
- Icon color: --danger
- Padding between items: 12px

---

REQUIREMENTS FOR ALL COMPONENTS:

1. Color compliance: ZERO custom colors, ONLY from DESIGN_SYSTEM.md
2. Spacing grid: 4px base → 8px, 12px, 16px, 24px, 32px
3. Typography locked: ONLY specified sizes and weights
4. Transitions: ALL 150ms ease-out minimum
5. Both themes: Light mode and Dark mode applied correctly
6. Hover states: Smooth, subtle, no jarring transitions
7. Accessibility: 4.5:1 minimum contrast, visible focus states
8. Professional aesthetic: Minimal, premium, resembles Apple design

---

APPROACH:

1. Read DESIGN_SYSTEM.md completely
2. Audit current styling (spacing, colors, typography)
3. Refine systematically:
   a. Navigation & headers
   b. Metric cards & filters
   c. Buttons & interactive elements
   d. Tables & data grids
   e. Badges & status indicators
   f. Charts & visualizations
   g. Leaderboard & gamification
   h. Negative feedback & alerts
4. Apply both light & dark mode color palettes
5. Test accessibility and contrast
6. Verify smooth transitions and hover states
7. Return production-ready code

DELIVERABLE:

Complete, refined dashboard code with:
✅ All components matching DESIGN_SYSTEM.md
✅ Consistent spacing throughout (no random px)
✅ System colors only
✅ Clear typography hierarchy
✅ Smooth 150ms transitions
✅ Both light & dark themes perfect
✅ WCAG AA accessibility compliance
✅ Enterprise-premium (Apple-like) aesthetic
✅ Production-ready quality

Let's refine this to excellence!
```

---

## HOW TO USE THIS

### Step 1: Prepare Your Project
```bash
cd your-dashboard-project/

# Make sure DESIGN_SYSTEM.md is in project root
cp devrev-dashboard-system.md ./DESIGN_SYSTEM.md

# Start Claude Code
claude-code
```

### Step 2: Tell Claude Code About Your Code
```
Tell Claude Code your project structure:
- What framework? (React, Vue, HTML+CSS?)
- What styling? (Tailwind, styled-components, CSS modules, inline?)
- Where are components? (src/components?)
- Do you have a build system? (webpack, vite, etc?)
```

### Step 3: Paste the Master Prompt Above
```
/read DESIGN_SYSTEM.md

[Wait for Claude to read it]

[Then paste the entire COPY-PASTE MASTER PROMPT above]
```

### Step 4: Let Claude Code Refine Everything
Claude Code will:
- Read the system
- Understand all requirements
- Refine every component
- Apply both color themes
- Test accessibility
- Return refined code

### Step 5: Review & Deploy
```
/read src/components/Dashboard.tsx

[Review the changes]

[Copy into your project]

npm run dev

[Test light & dark modes, all tabs, interactions]
```

---

## CUSTOMIZATION TIPS

Before pasting, you can customize:

Replace `[YOUR CODE STRUCTURE HERE]` with actual info:
```
My dashboard is built with:
- Framework: React 18
- Styling: Tailwind CSS + CSS modules
- Components: src/components/
- State management: Redux
- Charts: Recharts
- UI Library: None (custom components)

Main files:
- Dashboard.tsx (main component)
- MetricCard.tsx
- DataTable.tsx
- Charts/
```

Or ask Claude Code to learn your structure:
```
/files

[Claude lists all files]

Then I'll understand your structure and refine accordingly.
```

---

## EXPECTED RESULTS

After Claude Code finishes:

✅ **Metric cards** — Numbers pop at 32px bold, titles muted
✅ **Buttons** — Primary blue, smooth hover, 36px height
✅ **Tables** — Consistent spacing, subtle hover, monospace numbers
✅ **Charts** — System colors, faint grid lines, polished
✅ **Leaderboard** — Scores glow in warm orange, celebratory feel
✅ **Badges** — Color-coded, proper styling
✅ **Dark mode** — Perfect contrast, same structure
✅ **Transitions** — Smooth 150ms, no jarring changes
✅ **Accessibility** — WCAG AA compliant
✅ **Overall** — Enterprise-premium, minimal, Apple-like

---

## IF YOU NEED TWEAKS

After first pass, you can ask Claude Code:

```
"Leaderboard scores aren't standing out enough. Make them bolder and brighter."

"Dark mode text is hard to read. Increase text color brightness."

"Metric cards padding feels off. Make it exactly 16px."

"Charts need more color pop. Use brighter accent colors."

"Badges look flat. Add hover animations and make the styling more premium."
```

Claude Code will refine specific areas without redoing everything.

---

## TIME ESTIMATE

- Complete dashboard refinement: **2-4 hours**
- Initial refinement: **1-2 hours**
- Testing & tweaks: **30 min - 1 hour**

---

## YOU'RE READY!

You have:
✅ DESIGN_SYSTEM.md (design reference)
✅ Master Prompt (what to ask Claude Code)
✅ Feature Specs (detailed requirements)
✅ Workflow Guide (how to use Claude Code)

**Next: Open Claude Code, read the system, paste the prompt, and let's refactor to enterprise-premium!**
