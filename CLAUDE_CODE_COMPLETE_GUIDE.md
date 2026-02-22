# Claude Code: Complete Dashboard Refinement Guide

You're refining your **entire DevRev dashboard** to enterprise-premium using Claude Code. This guide walks you through the entire process.

---

## Part 1: Claude Code Setup

### Prerequisites
```bash
# Install Claude Code (if not already installed)
npm install -g @anthropic-ai/claude-code

# Verify installation
claude-code --version
```

### Starting Claude Code Session
```bash
# Navigate to your dashboard project
cd your-dashboard-project/

# Start Claude Code
claude-code

# Or with a specific file/directory
claude-code src/
```

### What You'll See
```
Claude Code Session Started
Working directory: /path/to/your-project

Available commands:
/help              - Show all commands
/files             - List project files
/read <path>       - Read a file
/create <path>     - Create a file
/edit <path>       - Edit a file
/run               - Execute code

Type your request or command...
```

---

## Part 2: Loading Your Design System

### Step 1: Create a DESIGN_SYSTEM.md in Your Project Root

```bash
# Copy your design system into project root
cp devrev-dashboard-system.md your-project/DESIGN_SYSTEM.md
```

Or create it directly in Claude Code:

```
/create DESIGN_SYSTEM.md

[Paste the entire design system content here]
```

### Step 2: Tell Claude Code to Use It

In your first prompt, add this:

```
I have a DESIGN_SYSTEM.md file in the project root that defines:
- All color values (hex codes for light & dark)
- Spacing grid (4px base)
- Typography scales
- Component specifications
- Accessibility requirements

Reference this file for ALL refinements. Never use colors/sizes outside this system.
```

### Step 3: Verify It's Loaded

Ask Claude Code:

```
/read DESIGN_SYSTEM.md

[Claude shows the design system]
```

Claude now has access to your system and will use it for all refinements.

---

## Part 3: Master Refinement Prompt (For All Features)

Copy and paste this **entire prompt** into Claude Code. This will refine your entire dashboard systematically.

```
DASHBOARD REFINEMENT: ENTERPRISE-PREMIUM POLISH

I'm refining my entire DevRev ticket review dashboard to enterprise-premium quality 
(Apple-like aesthetic: minimal, professional, polished).

PROJECT CONTEXT:
- Type: Internal support/leadership dashboard for DevRev tickets
- Users: CSM, TAM, Support, Regional Heads, Leadership
- Theme: Light & Dark mode
- Key sections: Ongoing Tickets, All Tickets, CSD Highlighted, My Views, Analytics, Gamification

DESIGN SYSTEM:
- Located in: DESIGN_SYSTEM.md (read and apply to ALL refinements)
- Colors: System palette only (no custom colors)
- Spacing: 4px grid (8px, 12px, 16px, 24px, 32px)
- Typography: Locked hierarchy (h1, h2, h3, h4, p, small)
- Borders: 1px subtle, radius 8px (buttons/inputs) or 12px (cards)
- Shadows: 0 1px 3px rgba(0,0,0,0.05) (subtle only)
- Transitions: 150ms ease-out (smooth, not instant)

REFINEMENT SCOPE:
All UI components across all features/tabs:
1. Metric cards (399, 136, 350 numbers)
2. Filter buttons (All Time, Team, Member, etc)
3. Action buttons (Save View, Filter)
4. Data table (ticket list with columns)
5. Status badges (On Hold, Pending, Open)
6. Pie charts (aggregated data visualization)
7. Leaderboard (CSAT Champions, team rankings)
8. Achievement badges (gamification)
9. Analytics charts (line/bar graphs)
10. Navigation tabs (Ongoing, All Tickets, Analytics, Gamification)

REFINEMENT REQUIREMENTS:

1. VISUAL HIERARCHY
   - Page titles clear and dominant (h1 level)
   - Section titles distinct (h2 level)
   - Metric titles muted (h4), metric values bold (32px / 700)
   - Button labels clear (14px / 500)
   - Supporting text recedes (12px / 400, muted color)

2. SPACING & PADDING
   - Card padding: 16px (lg)
   - Section gaps: 24px (xl)
   - Component gaps: 8px (sm)
   - Button padding: 10px 18px
   - Table cell padding: 12px horizontal, 8px vertical
   - NO random spacing values

3. COLOR CONSISTENCY
   - Use ONLY colors from DESIGN_SYSTEM.md
   - Primary button: #0066CC
   - Success badges: #34C759
   - Warning badges: #FF9500
   - Danger badges: #FF3B30
   - Gamification scores: #FF6B35 (warm, celebratory)
   - Text: --text-primary / --text-secondary / --text-tertiary
   - Backgrounds: --bg-primary / --bg-secondary / --bg-tertiary
   - Borders: --border / --border-subtle

4. TYPOGRAPHY
   - Font: Inter, system fonts
   - Sizes ONLY: 32px, 28px, 24px, 20px, 18px, 14px, 12px (no in-between)
   - Weights ONLY: 400, 500, 600, 700
   - Letter-spacing: -0.5px (titles), 0px (body), 0.5px (labels)
   - Line-height: minimum 1.4x (readable)

5. BORDERS & SHADOWS
   - Card borders: 1px solid (--border)
   - Card shadows: 0 1px 3px rgba(0,0,0,0.05) light / rgba(0,0,0,0.15) dark
   - Hover lift: 0 4px 12px rgba(0,0,0,0.08) + translateY(-1px)
   - NO thick borders, NO harsh shadows

6. INTERACTIONS
   - All transitions: 150ms ease-out
   - Hover states: subtle (background shift, shadow, opacity)
   - Active states: clear (color change, border shift)
   - NO bouncy/excessive animations
   - NO instant (0ms) changes

7. LIGHT & DARK MODE
   - Apply BOTH color palettes from DESIGN_SYSTEM.md
   - Same spacing/structure in both modes
   - Same typography hierarchy in both
   - Colors swap only
   - Contrast verified (WCAG AA: 4.5:1 text, 3:1 UI)

8. ACCESSIBILITY
   - Minimum font size: 12px
   - Minimum contrast: 4.5:1 for text
   - Focus states visible (borders, glows)
   - Color not relied upon alone (use icons too)
   - Keyboard navigation supported

9. SPECIFIC COMPONENT REFINEMENTS

   Metric Cards (big numbers):
   - Title: 12px / 500, color: --text-secondary
   - Number: 32px / 700, monospace, color: --text-primary
   - Container: 16px padding, border 1px, radius 12px, subtle shadow
   - Trend indicator: 14px / 500, success (green) or danger (red)

   Filter Buttons:
   - Inactive: --bg-secondary background, --text-primary text
   - Active: --primary background, white text
   - Height: 36px, padding: 10px 16px, radius: 8px
   - Transition: 150ms

   Data Table:
   - Header: --bg-secondary, 12px / 500, uppercase, letter-spacing 0.5px
   - Rows: --bg-primary, 14px / 400
   - Hover: --bg-secondary background, 100ms transition
   - Numbers: monospace font (precise appearance)
   - Borders: 1px bottom (--border-subtle)

   Status Badges:
   - Success: --success-light bg, --success text
   - Warning: --warning-light bg, --warning text
   - Danger: --danger-light bg, --danger text
   - Padding: 4px 8px, radius: 6px, 12px / 500 font

   Charts:
   - Container: border 1px, radius 12px, 16px padding
   - Grid lines: --border-subtle at 40% opacity
   - Colors: primary, success, warning, accent from system
   - Legend: 12px / 400, color: --text-secondary

   Leaderboard:
   - Rank: monospace, --text-secondary (muted)
   - Name: 14px / 400, --text-primary
   - Score: 14px / 500, --accent (#FF6B35) ← POPS!
   - Row padding: 12px 16px
   - Hover: --bg-secondary

   Achievements:
   - Badge background: --accent-light
   - Badge border: 1px solid --accent
   - Text: --accent color, 12px / 500
   - Icon: centered, premium appearance

   Navigation Tabs:
   - Inactive: --text-secondary, 14px / 500
   - Active: --text-primary, border-bottom 2px --primary
   - Padding: 12px 16px
   - Transition: 150ms

10. REFINEMENT APPROACH
    - Start with layout/structure (spacing)
    - Then apply colors (system palette)
    - Then typography (sizes, weights)
    - Then interactions (transitions, hover)
    - Then polish (shadows, radius)
    - Test light & dark modes for each step

DELIVERABLE:
Refine ALL components across ALL features to match DESIGN_SYSTEM.md exactly.
Return complete, production-ready code.

CODE STRUCTURE:
[Paste your dashboard code structure here]
- React? Vue? HTML+CSS? TypeScript?
- What's your component structure?
- Any CSS-in-JS (Tailwind, styled-components)?
- Any UI library (MUI, shadcn, etc)?

ADDITIONAL CONTEXT:
- Dashboard name: Customer Success Dashboard
- Key metrics shown: Healthy, Attention, Action ticket counts
- Data types: DevRev tickets, regional/team data
- Export data is important
- Real-time sync preferred

START WITH:
1. Read DESIGN_SYSTEM.md completely
2. Audit current state (spacing, colors, typography)
3. Refine all components systematically
4. Test both light & dark modes
5. Verify accessibility
6. Return production-ready code

Let's level this up to enterprise-premium.
```

---

## Part 4: Feature-by-Feature Specifications

### Feature 1: Navigation & Header

**Current:** Tabs for Ongoing Tickets, All Tickets, CSD Highlighted, My Views, Analytics, Gamification

**Refinement:**

```
NAVIGATION TABS:
- Container: --bg-primary background
- Tab spacing: 12px 16px (padding)
- Font: 14px / 500 (Body Medium)

Inactive Tab:
  - Color: --text-secondary
  - Border-bottom: transparent
  - Cursor: pointer
  - Transition: 150ms

Active Tab:
  - Color: --text-primary
  - Border-bottom: 2px solid --primary
  - Underline shifts smoothly

Hover (inactive):
  - Color: --text-primary
  - Background: --bg-secondary
  - Smooth transition

HEADER:
- Title: 24px / 600, --text-primary
- Subtitle: 12px / 400, --text-secondary
- Sync button: 36px height, secondary style
- Logout: 36px height, primary style (danger-tinted)
```

### Feature 2: Metric Cards (Top Row)

**Current:** 399 (Healthy), 136 (Attention), 350 (Action)

**Refinement:**

```
METRIC CARD:
- Background: --bg-primary
- Border: 1px solid --border
- Padding: 20px (generous for prominence)
- Border-radius: 12px
- Shadow: 0 1px 3px rgba(0,0,0,0.05)

Title (e.g., "HEALTHY (< 10 DAYS)"):
  - Font: 12px / 500 (h4)
  - Color: --text-secondary
  - Margin-bottom: 8px

Number (e.g., "399"):
  - Font: 32px / 700 weight
  - Font-family: 'SF Mono', monospace (precise look)
  - Color: --text-primary
  - Line-height: 40px

Trend Indicator (if present):
  - Font: 14px / 500
  - Color: --success (if positive ↑)
  - Color: --danger (if negative ↓)

Icon (if present):
  - 16px size
  - Color: --text-secondary
  - Right-aligned

Hover:
  - Shadow: 0 4px 12px rgba(0,0,0,0.08)
  - Transform: translateY(-1px)
  - Transition: all 150ms ease-out
```

### Feature 3: Filter Controls

**Current:** All Time, Team, Member, Region, Account, CSM, TAM, Stage, filters

**Refinement:**

```
FILTER BUTTON GROUP:
- Container: --bg-primary (no background)
- Gap between buttons: 8px (sm)
- Wrap on mobile

Individual Filter Button:
  Inactive:
    - Background: --bg-secondary
    - Border: 1px solid --border
    - Color: --text-primary
    - Height: 36px
    - Padding: 8px 12px
    - Border-radius: 8px
    - Font: 12px / 500
    - Cursor: pointer

  Hover:
    - Background: --bg-tertiary
    - Border-color: --border (unchanged)
    - Transition: 100ms ease-out

  Active:
    - Background: --primary
    - Border: 1px solid --primary
    - Color: white (#FFFFFF)
    - Transition: 150ms ease-out

  Disabled:
    - Background: --bg-secondary
    - Color: --text-tertiary
    - Opacity: 0.5
    - Cursor: not-allowed

ACTION BUTTONS (Save View, Filter, etc):
  - Same as primary button spec
  - Height: 36px
  - Background: --primary
  - Text: white
  - Padding: 10px 18px
  - Radius: 8px
  - Font: 14px / 500
  - Hover: background → --primary-hover (#0052A3)
  - Active: background → --primary-active (#003D7A)
```

### Feature 4: Data Table (Ticket List)

**Current:** Shows columns - Ticket, Region, Owner, CSM, TAM, Team, Assignee, Stage, RWT, Iter, Age, Status

**Refinement:**

```
TABLE CONTAINER:
- Border: 1px solid --border
- Border-radius: 12px
- Background: --bg-primary
- Overflow: auto (for mobile)

TABLE HEADER ROW:
- Background: --bg-secondary
- Padding: 12px (horizontal), 8px (vertical)
- Font: 12px / 500 (Small Medium)
- Color: --text-secondary
- Text-transform: uppercase
- Letter-spacing: 0.5px (data style)
- Border-bottom: 1px solid --border
- Sticky on scroll

TABLE DATA ROW:
- Padding: 12px (horizontal), 8px (vertical)
- Font: 14px / 400 (Body Regular)
- Color: --text-primary
- Border-bottom: 1px solid --border-subtle
- Background: --bg-primary

Row Hover:
- Background: --bg-secondary
- Transition: 100ms ease-out
- Cursor: pointer (if clickable)

SPECIFIC COLUMNS:

Ticket ID:
  - Font: monospace (precise appearance)
  - Color: --primary (linked)
  - Hover: underline

Status Badge:
  - Success (Healthy): --success-light bg, --success text
  - Warning (Attention): --warning-light bg, --warning text
  - Danger (Action): --danger-light bg, --danger text
  - Padding: 4px 8px, radius: 6px
  - Font: 12px / 500

Time Values (RWT, Age):
  - Font: monospace
  - Color: --text-primary
  - Right-aligned

Date Columns:
  - Font: 12px / 400
  - Color: --text-secondary

Icons (expand, link, etc):
  - Size: 16px
  - Color: --text-secondary
  - Hover: --primary
  - Transition: 100ms
```

### Feature 5: Pie Charts (Aggregation View)

**Current:** Shows Open, Pending, On Hold, Solved (each with pie chart breakdown by person)

**Refinement:**

```
CHART CARD CONTAINER:
- Border: 1px solid --border
- Border-radius: 12px
- Padding: 16px (lg)
- Background: --bg-primary
- Shadow: 0 1px 3px rgba(0,0,0,0.05)

Chart Title:
- Font: 18px / 600 (h3)
- Color: --text-primary
- Margin-bottom: 12px

PIE CHART:
- Colors ONLY from system:
  - Primary series: --primary (#0066CC)
  - Accent: --accent (#FF6B35)
  - Success: --success (#34C759)
  - Warning: --warning (#FF9500)
  - Secondary: --text-secondary (muted)
- No decorative gradients
- Border: 1px subtle between slices
- Label font: 12px / 400, --text-secondary

Legend:
- Position: below or beside chart
- Font: 12px / 400
- Color: --text-secondary
- Spacing: 12px between items
- Color square: 8px, solid color

Data Label (if on-hover):
- Font: 12px / 500
- Background: --bg-secondary
- Padding: 4px 8px
- Border-radius: 6px
- Shadow: subtle

Hover Interaction:
- Segment highlight: increase opacity slightly
- Label shows (if hidden)
- Transition: 100ms
```

### Feature 6: Analytics Tab (Charts & Graphs)

**Current:** Performance metrics, Response time, Resolution time, NPS, Customer satisfaction, Backlog, CSAT Leaderboard, Active Negative Feedback

**Refinement:**

```
PERFORMANCE OVERVIEW CARDS (KPI metrics):
- Same metric card spec as top-row metrics
- 32px / 700 numbers
- 12px / 500 titles
- 16px padding, 1px border, subtle shadow

PERFORMANCE ANALYTICS (Line/Area charts):
- Container: 12px / 400 rounded, border 1px, 16px padding
- Title: 18px / 600, margin-bottom: 12px
- Chart height: 200px min
- Grid lines: --border-subtle at 40% opacity
- Axes labels: 12px / 400, --text-secondary
- Legend: below chart, 12px / 400

Line Chart Colors:
- Primary line: --primary (#0066CC)
- Secondary: --success (#34C759)
- Tertiary: --warning (#FF9500)
- Subtle: --text-secondary (muted)
- Stroke width: 2px
- No fill (clean look)
- Dots on hover only

Area Chart (if used):
- Fill: color at 10-15% opacity (subtle)
- Border: solid line 2px
- Same color palette

X-Axis (dates):
- Format: "22 Feb", "23 Feb", etc
- Rotate text if needed
- Color: --text-secondary

Y-Axis (values):
- Right-aligned
- Color: --text-secondary
- No gridlines on Y (only X)

Tooltip (on hover):
- Background: --bg-secondary with border
- Text: 12px / 400, --text-primary
- Padding: 8px 12px
- Border-radius: 6px
- Shadow: subtle
- Transition: 100ms

Zoom/Drill-down Buttons:
- 36px height, secondary style
- Margin-top: 12px
- Smooth state changes
```

### Feature 7: CSAT Champions Leaderboard

**Current:** Shows rank (1, 2, 3), name, score, badges

**Refinement:**

```
LEADERBOARD CONTAINER:
- Border: 1px solid --border
- Border-radius: 12px
- Padding: 16px
- Background: --bg-primary
- Shadow: 0 1px 3px rgba(0,0,0,0.05)

Title:
- Font: 18px / 600 (h3)
- Color: --text-primary
- Margin-bottom: 16px

LEADERBOARD ROW:
- Padding: 12px 16px
- Border-bottom: 1px solid --border-subtle
- Display: flex, space-between, align-center
- Background: --bg-primary

Rank (1, 2, 3, etc):
- Font: monospace, 14px / 500
- Color: --text-secondary (muted)
- Width: 30px
- Text-align: center
- Font-weight: bold

Rank Icons (optional, for top 3):
- 1st: 🥇 Gold medal
- 2nd: 🥈 Silver medal
- 3rd: 🥉 Bronze medal
- Size: 20px, centered

Name:
- Font: 14px / 500 (Body Medium)
- Color: --text-primary
- Flex: 1
- Margin-left: 12px

Score:
- Font: 14px / 500
- Color: --accent (#FF6B35) ← WARM, CELEBRATORY!
- Font-weight: 700
- Monospace for precision
- Margin-left: auto

Badge/Achievement Icon:
- Size: 20px
- Right-aligned
- Margin-left: 12px
- Icon styles:
  - Gold star: --accent
  - Silver star: --text-secondary
  - Achievement: --primary

Row Hover:
- Background: --bg-secondary
- Transition: 100ms ease-out
- Shadow: subtle lift (optional)
- Cursor: pointer

Row Styling by Rank:
- 1st place: +4px top padding, gold accent
- 2nd place: normal
- 3rd place: normal
- 4+: normal
- Visual distinction without too much decoration
```

### Feature 8: Achievement Badges (Gamification)

**Current:** Shows medals/badges for achievements

**Refinement:**

```
ACHIEVEMENT BADGE:
- Container: 80px x 80px (square card)
- Background: --accent-light (#FEF0E8)
- Border: 2px solid --accent (#FF6B35)
- Border-radius: 12px
- Padding: 8px
- Shadow: 0 1px 3px rgba(0,0,0,0.05)

Badge Icon/Graphic:
- Size: 48px
- Centered in container
- Color: --accent
- Icon types: crown, star, medal, trophy
- Scalable SVG (not rasterized)

Badge Label (below icon):
- Font: 12px / 600
- Color: --accent
- Text-align: center
- Margin-top: 4px
- Text-transform: capitalize

Hover State:
- Shadow: 0 4px 12px rgba(255, 107, 53, 0.15)
- Transform: scale(1.05)
- Transition: all 150ms ease-out

Unlocked Badge:
- Full opacity, full color
- Clickable for details

Locked Badge (if applicable):
- Opacity: 0.4
- Grayscale: 50%
- Cursor: not-allowed
- Label: "Locked" in small text

Multiple Badge Layout:
- Grid: 3-4 badges per row
- Gap: 16px between badges
- Responsive: 2 per row on tablet, 1 on mobile

Achievement Detail Popup (on click):
- Modal background: rgba(0,0,0,0.5)
- Modal card: --bg-primary, border 1px, radius 12px
- Title: 18px / 600
- Description: 14px / 400, --text-secondary
- Unlock condition: 12px / 400, --text-tertiary
- Unlock date: 12px / 500, --text-primary
- Close button: primary style
```

### Feature 9: Negative Feedback Section

**Current:** Shows issues that need attention

**Refinement:**

```
NEGATIVE FEEDBACK CONTAINER:
- Border: 1px solid --danger at 50% opacity
- Border-radius: 12px
- Padding: 16px
- Background: --danger-light (#FFEBEE)
- Shadow: 0 1px 3px rgba(255, 59, 48, 0.1)

Section Title:
- Font: 18px / 600
- Color: --danger
- Icon: ⚠️ warning icon, 20px
- Icon color: --danger
- Margin-bottom: 12px

Feedback Items:
- Each item: 14px / 400, --text-primary
- List with subtle dividers
- Icon: 🔔 notification icon
- Icon color: --danger
- Padding: 12px 0

Item Text:
- Truncate if long (show "..." + expand)
- On hover: full text visible
- Tooltip: full message

Action Button (if present):
- Font: 12px / 500
- Background: --danger
- Color: white
- Padding: 6px 12px
- Border-radius: 6px
- Hover: --danger-active (darker)

Close/Dismiss Button:
- Icon: ✕
- Size: 20px
- Color: --danger
- Hover: scale(1.1)
- Cursor: pointer

Light Mode:
- Background: #FFEBEE
- Border: 1px solid #FFCDD2

Dark Mode:
- Background: #661414
- Border: 1px solid #8B2C2C
```

### Feature 10: Tab Navigation & Page Structure

**Current:** Ongoing Tickets, All Tickets, CSD Highlighted, My Views, Analytics, Gamification

**Refinement:**

```
TAB NAVIGATION CONTAINER:
- Position: sticky or fixed (if needed)
- Background: --bg-primary
- Border-bottom: 1px solid --border
- Padding: 0 (full-width)
- Height: auto

TAB ITEM:
- Padding: 12px 16px
- Font: 14px / 500
- Color: --text-primary (active) / --text-secondary (inactive)
- Position: relative
- Cursor: pointer
- Transition: all 150ms ease-out

Active Tab Indicator:
- Position: bottom (underline)
- Height: 2px
- Width: match text width
- Color: --primary (#0066CC)
- Border-radius: 2px 2px 0 0
- Animation: slides from left/right on change

Inactive Tab Hover:
- Background: --bg-secondary
- Color: --text-primary
- Transition: 100ms ease-out

Icon (if present in tab):
- Size: 16px
- Color: inherit
- Margin-right: 6px
- Align: vertical center

Tab Badge (notification, if present):
- Size: 16px circle
- Background: --danger
- Color: white
- Font: 10px / 700
- Position: top-right of icon
- Font-weight: bold
- Number: 1-digit (0-9)

PAGE CONTENT AREA:
- Padding: 24px
- Min-height: calc(100vh - header - tabs)
- Background: --bg-primary
- Smooth fade/transition between tabs (100ms)

Responsive:
- On tablet: tabs scroll horizontally if needed
- On mobile: tab text may truncate
- Ensure 36px minimum hit area per tab
```

---

## Part 5: Master Prompt (To Send to Claude Code)

Once you have your codebase structure clear, send this to Claude Code:

```
/read DESIGN_SYSTEM.md

[Claude reads the system]

---

[Then paste the Master Refinement Prompt from Part 3 above, customized with:]

1. Your actual code structure (React? Vue? HTML/CSS?)
2. Your exact file paths
3. Your component structure
4. Any CSS framework (Tailwind, styled-components, etc)

---

Then ask:

"Refine my entire dashboard to match DESIGN_SYSTEM.md. 
Use the feature specifications provided. 
Make sure light and dark modes both work perfectly. 
Return production-ready code with all components refined to enterprise-premium quality."
```

---

## Part 6: Claude Code Workflow for Refinement

### Step 1: Read the Design System
```
/read DESIGN_SYSTEM.md
```

### Step 2: List Project Files
```
/files

[Claude shows your project structure]
```

### Step 3: Read Your Main Component
```
/read src/components/Dashboard.tsx

[Or whatever your main file is]
```

### Step 4: Send Master Refinement Prompt
```
[Paste the Master Refinement Prompt + feature specs]

Pay special attention to:
- Metric cards (make numbers 32px bold)
- Tables (proper spacing and hover)
- Badges (system colors only)
- Leaderboard (scores use #FF6B35)
- Charts (colors from system)
- Transitions (150ms ease-out)
- Both light & dark modes
```

### Step 5: Claude Code Refines Everything
Claude Code will:
- Update all components
- Apply consistent spacing
- Use system colors only
- Add smooth transitions
- Handle both themes
- Test accessibility

### Step 6: Review & Apply
```
/read [refactored file]

[Verify the changes look good]

[Copy into your project]
```

### Step 7: Test in Your App
```
npm run dev
# or
npm start

[Check light mode, dark mode, all tabs, all interactions]
```

---

## Part 7: Integration Checklist

After Claude Code refines everything, **verify each feature:**

### Navigation
- [ ] Tabs have proper styling
- [ ] Active tab has blue underline
- [ ] Hover states smooth
- [ ] Both light & dark modes work

### Metric Cards
- [ ] Numbers are 32px / 700 weight
- [ ] Titles are 12px / 500 muted
- [ ] Padding is exactly 16px
- [ ] Shadows are subtle (not harsh)
- [ ] Hover lifts 1px with shadow

### Filters
- [ ] Inactive: gray background
- [ ] Active: primary blue
- [ ] Height exactly 36px
- [ ] Hover transitions smooth
- [ ] All filters use system colors

### Data Table
- [ ] Header background is --bg-secondary
- [ ] Rows alternate/hover subtly
- [ ] Numbers use monospace
- [ ] Spacing consistent (12px/8px)
- [ ] Border-bottom on rows

### Badges
- [ ] Success: green text + light green bg
- [ ] Warning: orange text + light orange bg
- [ ] Danger: red text + light red bg
- [ ] No custom colors

### Charts
- [ ] Pie colors from system palette
- [ ] Grid lines very faint
- [ ] Legend 12px text
- [ ] Hover interactions smooth

### Leaderboard
- [ ] Rank numbers muted
- [ ] Names normal text
- [ ] Scores in WARM ORANGE (#FF6B35) ← Pops!
- [ ] Medals/badges visible
- [ ] Hover state subtle

### Achievements
- [ ] Background: --accent-light
- [ ] Border: 2px --accent
- [ ] Icon centered and sized properly
- [ ] Hover: scale + shadow
- [ ] Grid layout responsive

### Dark Mode
- [ ] Text readable in dark (light color)
- [ ] Backgrounds dark (not pure black)
- [ ] Contrast minimum 4.5:1
- [ ] Same spacing as light mode
- [ ] Colors swapped correctly

### Accessibility
- [ ] Minimum font size 12px ✓
- [ ] Focus states visible ✓
- [ ] Keyboard navigation works ✓
- [ ] Color contrast good ✓
- [ ] Icons have alt text ✓

### Overall Polish
- [ ] No random spacing values ✓
- [ ] All transitions are 150ms ✓
- [ ] No instant (0ms) changes ✓
- [ ] Shadows subtle and consistent ✓
- [ ] Typography hierarchy clear ✓
- [ ] Feels premium & minimal ✓
- [ ] Resembles Apple-like aesthetic ✓
- [ ] Enterprise-ready ✓

---

## Part 8: Common Claude Code Commands

### Useful Commands During Refinement

```
# Read the design system
/read DESIGN_SYSTEM.md

# List all files
/files

# Read a specific file
/read src/components/MetricCard.tsx

# Search for something
/search "color: #" src/

# Create a new refined file
/create src/components/MetricCard.tsx

# Edit an existing file
/edit src/components/MetricCard.tsx

# Run tests
/run npm test

# Run your dev server
/run npm run dev

# Build
/run npm run build

# Get context
/context

# Help
/help
```

### Getting Status During Refinement

```
Ask Claude Code:

"What files have you modified so far?"

"Show me a summary of all the changes"

"Are there any styling inconsistencies remaining?"

"Did I miss any components?"

"Verify both light and dark modes are working"
```

---

## Part 9: Phased Refinement Approach

If you want to refine in phases instead of all at once:

### Phase 1: Core Components (1-2 hours)
- Metric cards
- Buttons (filter, action)
- Navigation tabs
- Cards/containers

### Phase 2: Data Visualization (1-2 hours)
- Tables (ticket list)
- Badges (status, inline)
- Charts (pie, line, bar)

### Phase 3: Advanced Features (1 hour)
- Leaderboard (CSAT Champions)
- Achievements (badges, medals)
- Negative feedback section

### Phase 4: Polish & Accessibility (30 min)
- Dark mode audit
- Accessibility verification
- Interaction polish
- Final testing

---

## Part 10: If Something Goes Wrong

**Issue:** Claude Code changes too much

**Fix:** Be more specific in your prompt:
```
"Refine ONLY the metric cards. 
Don't touch tables or charts yet.
Keep everything else unchanged."
```

**Issue:** Colors don't match system

**Fix:** Paste the DESIGN_SYSTEM.md color section again:
```
"Use ONLY these colors:
--primary: #0066CC
--success: #34C759
[etc]

Replace any colors not in this list."
```

**Issue:** Spacing looks different

**Fix:** Specific spacing request:
```
"Card padding should be exactly 16px.
Gaps between sections: 24px.
Component gaps: 8px.
Replace all other spacing values."
```

**Issue:** Dark mode broken

**Fix:** Show the dark mode colors:
```
"/read DESIGN_SYSTEM.md

Now apply the dark mode color palette from this system to all components.
Test that both modes have minimum 4.5:1 contrast."
```

**Issue:** Too many changes at once

**Fix:** Break into smaller requests:
```
"Claude, I'll give you one component at a time.
First, refine ONLY this metric card to match the system.
Don't touch anything else.

[show one component]"
```

---

## Summary

You now have everything to refine your entire dashboard in Claude Code:

✅ **devrev-dashboard-system.md** — Design system (in project root)
✅ **Master Refinement Prompt** — What to ask Claude Code (in Part 3)
✅ **Feature-by-Feature Specs** — Detailed requirements (in Part 4)
✅ **Integration Checklist** — What to verify (in Part 7)
✅ **Workflow Guide** — Step-by-step process (in Part 6)
✅ **Troubleshooting** — Common fixes (in Part 10)

**Next step:**
1. Put DESIGN_SYSTEM.md in your project root
2. Open Claude Code
3. Read the design system: `/read DESIGN_SYSTEM.md`
4. List your files: `/files`
5. Paste the Master Refinement Prompt (customized for your code)
6. Let Claude Code refine everything

**Estimated time:** 2-4 hours for complete dashboard refinement

Go make it enterprise-premium! 🚀
