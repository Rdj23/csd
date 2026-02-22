# DevRev Internal Ticket Dashboard Design System

## Direction
- **Personality**: Premium, Minimal, Trustworthy
- **Aesthetic**: Apple-inspired (generous whitespace, restrained color, refined typography)
- **Foundation**: Neutral with sophisticated blue accent
- **Depth**: Subtle elevation, smooth transitions
- **Use case**: Executive/support leadership reviewing critical ticket data, long analytical sessions
- **Target**: Internal employees (CSM, TAM, Support, Regional Heads, Leadership)

---

## Color Palette

### Light Mode
```
// Primary Actions (Trust, Precision)
--primary: #0066CC (Medium blue - premium, trustworthy)
--primary-hover: #0052A3 (Darker on hover)
--primary-active: #003D7A (Pressed state)

// Success & Growth (Gamification, Positive)
--success: #34C759 (Apple green - uplifting)
--success-light: #E8F5E9 (Very subtle background)

// Warning & Attention
--warning: #FF9500 (Apple orange - noticeable but not alarming)
--warning-light: #FEF3E2

// Critical Issues
--danger: #FF3B30 (Apple red - urgent, but refined)
--danger-light: #FFEBEE

// Neutral Foundation
--bg-primary: #FFFFFF (Main background)
--bg-secondary: #F5F7FA (Card/section background - very subtle)
--bg-tertiary: #EAEEF5 (Hover states, subtle distinction)

--text-primary: #1D1D1D (Near black, readable)
--text-secondary: #6B7280 (Supporting text, muted)
--text-tertiary: #A0AEC0 (Hints, disabled)

--border: #E5E7EB (Subtle dividers)
--border-subtle: #F3F4F6 (Very faint lines)

// Accent for Gamification
--accent: #FF6B35 (Warm orange - achievement/reward feeling)
--accent-light: #FEF0E8
```

### Dark Mode
```
// Primary (adjusted for dark backgrounds)
--primary: #3B82F6 (Brighter blue for dark mode)
--primary-hover: #2563EB
--primary-active: #1D4ED8

// Success
--success: #34C759 (Same - works in both)
--success-light: #1F5F3F (Dark mode card bg)

// Warning
--warning: #FF9500
--warning-light: #663F1F

// Danger
--danger: #FF3B30
--danger-light: #661414

// Neutral Foundation (Dark)
--bg-primary: #0F1419 (Near black, easy on eyes)
--bg-secondary: #1A202C (Card background - not too bright)
--bg-tertiary: #2D3748 (Hover states)

--text-primary: #F8FAFC (Off-white, easy to read)
--text-secondary: #CBD5E0 (Muted, secondary)
--text-tertiary: #A0AEC0 (Disabled, hints)

--border: #2D3748 (Subtle in dark)
--border-subtle: #1A202C (Very faint)

// Accent
--accent: #FF6B35
--accent-light: #3F2415
```

---

## Typography

**Font Stack**: `Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
(Falls back to system fonts like macOS)

### Heading Hierarchy
```
h1 (Page Title - "Ticket Dashboard")
  - Size: 32px
  - Weight: 700
  - Line Height: 40px
  - Letter Spacing: -0.5px (Apple-like tightness)
  - Color: --text-primary
  - Usage: Main page titles

h2 (Section Title - "Analytics", "Gamification")
  - Size: 24px
  - Weight: 600
  - Line Height: 32px
  - Letter Spacing: -0.3px
  - Color: --text-primary
  - Usage: Tab titles, major sections

h3 (Card Title - "CSAT Leaderboard")
  - Size: 18px
  - Weight: 600
  - Line Height: 26px
  - Letter Spacing: -0.2px
  - Color: --text-primary
  - Usage: Card headers, subsections

h4 (Metric Label - "Avg Resolution Time")
  - Size: 14px
  - Weight: 600
  - Line Height: 20px
  - Letter Spacing: 0px
  - Color: --text-secondary
  - Usage: Data labels, metric names
```

### Body & UI Text
```
Body Regular (Main text in cards)
  - Size: 14px
  - Weight: 400
  - Line Height: 20px
  - Letter Spacing: 0px
  - Color: --text-primary
  - Usage: Paragraph text, descriptions

Body Medium (Slightly emphasized)
  - Size: 14px
  - Weight: 500
  - Line Height: 20px
  - Color: --text-primary
  - Usage: Button labels, slightly important text

Small Regular (Supporting text)
  - Size: 12px
  - Weight: 400
  - Line Height: 16px
  - Letter Spacing: 0px
  - Color: --text-secondary
  - Usage: Helper text, timestamps, metadata

Small Medium (Labels for form inputs)
  - Size: 12px
  - Weight: 500
  - Line Height: 16px
  - Color: --text-secondary
  - Usage: Form labels, tags, badges

Monospace (Data values, counts)
  - Font: 'SF Mono', 'Monaco', monospace
  - Size: 14px
  - Weight: 400
  - Color: --text-primary
  - Usage: Ticket numbers, counts, exact metrics
```

---

## Spacing System

**Base Unit**: 4px (Apple's approach - precise, scalable)

```
xs: 4px      (tight spacing, micro interactions)
sm: 8px      (component padding, small gaps)
md: 12px     (standard component padding)
lg: 16px     (card padding, section spacing)
xl: 24px     (major section separation)
2xl: 32px    (page margins, tab separation)
3xl: 48px    (major layout breaks)
```

### Application
- **Card Padding**: 16px (lg)
- **Button Padding**: 10px 16px (sm vertical, md horizontal)
- **Input Padding**: 8px 12px (sm vertical, md horizontal)
- **Table Cell Padding**: 12px horizontal, 8px vertical
- **Section Margin**: 24px (xl) between major sections
- **Page Margin**: 24px (xl) outer edges
- **Component Gap**: 8px (sm) between buttons/elements

---

## Component Specs

### Button (Primary - CTA)
```
States:
  Default:
    - Background: --primary
    - Text: White (#FFFFFF)
    - Height: 36px
    - Padding: 10px 18px (centered)
    - Border Radius: 8px
    - Font: Body Medium (14px / 500)
    - Box Shadow: none (Apple minimalist)
    - Border: none

  Hover:
    - Background: --primary-hover
    - Cursor: pointer
    - Transition: background 150ms ease-out

  Active/Pressed:
    - Background: --primary-active
    - Scale: 0.98 (subtle press animation)

  Disabled:
    - Background: --text-tertiary
    - Opacity: 0.5
    - Cursor: not-allowed
```

### Button (Secondary - Less emphasis)
```
Default:
  - Background: --bg-secondary
  - Text: --text-primary
  - Border: 1px solid --border
  - Height: 36px
  - Padding: 10px 18px
  - Border Radius: 8px

Hover:
  - Background: --bg-tertiary
```

### Card Container
```
Default:
  - Background: --bg-primary
  - Border: 1px solid --border
  - Border Radius: 12px (larger for premium feel)
  - Padding: 16px (lg)
  - Box Shadow: 0 1px 3px rgba(0,0,0,0.05) (ultra subtle)
  - Transition: all 150ms ease-out

Hover (optional - subtle lift):
  - Box Shadow: 0 4px 12px rgba(0,0,0,0.08)
  - Transform: translateY(-1px) (1px lift)
```

### Input Field
```
Default:
  - Border: 1px solid --border
  - Background: --bg-primary
  - Height: 36px
  - Padding: 8px 12px
  - Border Radius: 8px
  - Font: Body Regular (14px)
  - Color: --text-primary
  - Placeholder: --text-tertiary

Focus:
  - Border: 2px solid --primary
  - Box Shadow: 0 0 0 3px rgba(0, 102, 204, 0.1) (subtle halo)
  - Outline: none

Disabled:
  - Background: --bg-secondary
  - Color: --text-tertiary
  - Cursor: not-allowed
```

### Data Table
```
Header Row:
  - Background: --bg-secondary
  - Border Bottom: 1px solid --border
  - Font: Small Medium (12px / 500)
  - Color: --text-secondary
  - Padding: 12px horizontal, 8px vertical
  - Text Transform: Uppercase, Letter Spacing 0.5px (data style)

Data Rows:
  - Background: --bg-primary
  - Border Bottom: 1px solid --border-subtle
  - Font: Body Regular (14px)
  - Color: --text-primary
  - Padding: 12px horizontal, 8px vertical
  - Monospace for numbers (exact appearance)

Hover:
  - Background: --bg-secondary (light highlight)
  - Transition: background 100ms ease-out

Striped (optional for readability):
  - Alt rows: --bg-secondary (very subtle stripe)
```

### Tabs (Analytics, Gamification sections)
```
Container:
  - Border Bottom: 1px solid --border
  - Background: --bg-primary
  - No padding on tab bar itself

Tab Button:
  - Padding: 12px 16px
  - Font: Body Medium (14px / 500)
  - Color: --text-secondary (inactive)
  - Border Bottom: 2px solid transparent
  - Cursor: pointer

Active Tab:
  - Color: --text-primary
  - Border Bottom: 2px solid --primary
  - Box Shadow: inset 0 -2px 0 --primary (better visual weight)

Hover (inactive):
  - Color: --text-primary
  - Background: --bg-secondary (subtle hover)
```

### Badge / Metric Label
```
Success Badge:
  - Background: --success-light
  - Color: --success
  - Padding: 4px 8px
  - Border Radius: 6px
  - Font: Small Medium (12px / 500)

Warning Badge:
  - Background: --warning-light
  - Color: --warning
  - Same sizing

Danger Badge:
  - Background: --danger-light
  - Color: --danger
  - Same sizing
```

### Metric Card (Big number display)
```
Container:
  - Background: --bg-primary
  - Border: 1px solid --border
  - Border Radius: 12px
  - Padding: 20px (generous)

Metric Title:
  - Font: Small Medium (12px / 500)
  - Color: --text-secondary
  - Margin Bottom: 8px

Metric Value:
  - Font: 32px / 700 / 40px line-height (bold presence)
  - Color: --text-primary
  - Monospace font for precision

Metric Trend (if showing ↑/↓):
  - Font: 14px / 500
  - Color: --success (for positive), --danger (for negative)
  - Icon: Use SF Symbols or similar minimal icons
```

### Chart/Graph Area
```
Chart Container:
  - Background: --bg-primary
  - Border: 1px solid --border
  - Border Radius: 12px
  - Padding: 16px (lg)

Grid Lines:
  - Color: --border-subtle
  - Opacity: 0.4 (very faint)
  - Weight: 1px

Chart Labels:
  - Font: Small Regular (12px / 400)
  - Color: --text-secondary

Legend:
  - Font: Small Regular (12px / 400)
  - Color: --text-secondary
  - Spacing: 12px between items

Chart Colors (for multiple series):
  - Primary: --primary
  - Success: --success
  - Warning: --warning
  - Accent: --accent
  - Secondary: --text-secondary (muted)
```

### Gamification Elements
```
Leaderboard Row:
  - Background: --bg-primary
  - Border Bottom: 1px solid --border-subtle
  - Padding: 12px 16px
  - Rank Number: Monospace, --text-secondary
  - Name: Body Medium, --text-primary
  - Score: Body Medium + --accent color (makes it pop)

Achievement Badge:
  - Background: --accent-light
  - Border: 1px solid --accent
  - Padding: 8px 12px
  - Border Radius: 8px
  - Color: --accent
  - Font: Small Medium (12px / 500)
  - Icon: Medal/star symbol (premium feel)

Progress Bar (if used):
  - Background: --bg-tertiary
  - Fill: --accent (warm, celebratory)
  - Height: 6px
  - Border Radius: 3px
```

---

## Interactions & Animations

### Transitions (Premium, not jarring)
```
Fast (UI feedback): 100ms ease-out
  - Button hover/press
  - Input focus
  - Hover states

Medium (Component change): 150ms ease-out
  - Tab switches
  - Card animations
  - Modal open/close

Slow (Page transitions): 200ms ease-out
  - Full page changes
  - Large modal appearances
```

### Micro-interactions
- Button press: Slight scale (0.98) + background change
- Hover lift: 1px translateY + shadow increase
- Input focus: Border color + subtle glow (0 0 0 3px halo)
- Tab switch: Underline slides smoothly
- Icon animations: Minimal, 200ms rotation/scale

### No Jarring Effects
- No bouncy animations
- No excessive shadows
- Keep motion purposeful, minimal
- Smooth, refined feel

---

## Light & Dark Mode Implementation

### Automatic Switching
Both color palettes defined above. Use CSS variables or your framework's theme system.

**Example (CSS):**
```css
:root {
  /* Light mode defaults */
  --primary: #0066CC;
  --bg-primary: #FFFFFF;
  --text-primary: #1D1D1D;
  /* ... etc */
}

@media (prefers-color-scheme: dark) {
  :root {
    /* Dark mode overrides */
    --primary: #3B82F6;
    --bg-primary: #0F1419;
    --text-primary: #F8FAFC;
    /* ... etc */
  }
}
```

Or use your framework's theme switcher (React Context, Tailwind, etc).

### Consistency Rules
- Same spacing in both modes
- Same typography sizes in both modes
- Same component structure in both modes
- Only colors/brightness change
- Ensure sufficient contrast in both modes (WCAG AA minimum: 4.5:1 for text)

---

## Accessibility

### Contrast Ratios (WCAG AA compliance)
- Text on background: 4.5:1 minimum
- UI elements: 3:1 minimum
- Light mode verified
- Dark mode verified

### Color Independence
- Don't rely ONLY on color (use icons for success/warning/danger)
- Example: ✓ + green for success, not just green

### Focus States
- Visible focus indicators (2px border or halo)
- Never remove focus outlines
- Keyboard navigation fully supported

### Typography
- Minimum font size: 12px (readable)
- Line height: minimum 1.4x (20px for 14px text)
- Adequate letter spacing for all sizes

---

## Specific Guidance by Page/Feature

### Home: Ticket Data Overview
```
Layout:
  - Top: Page title (h1) + quick filters
  - Grid of metric cards (big numbers with trends)
  - Main table with ticket list

Metric Cards:
  - Show: Total tickets, Open, In Progress, Resolved, CSAT score
  - Use --success/--warning/--danger for trends
  - Large, scannable numbers (32px)

Table:
  - Ticket ID (monospace)
  - Title (truncated if long)
  - Status (badge with color coding)
  - Assigned to (avatar + name, if supported)
  - Created/Updated date
  - Priority (color-coded badge)
```

### Analytics Tab
```
Layout:
  - Multiple chart containers in grid
  - Each chart: 12px border, generous padding
  - Charts: Pie charts, line graphs, bar charts
  - Color-coded by status/category

Grid Patterns:
  - 2-column for desktop
  - 1-column for tablet/mobile
  - Even spacing between charts (24px gap)

Supporting Table:
  - CSAT leaderboard below/alongside
  - Monospace numbers for precise values
```

### Gamification Tab
```
Layout:
  - Leaderboard (table format)
  - User profile area with badges/achievements
  - Progress bars (if goals are used)

Leaderboard:
  - Rank (1, 2, 3...) left side
  - User name + avatar
  - Score (use --accent color to make it pop and celebrate)
  - Badges (achievement icons below)

Achievement Display:
  - Grid of badge cards
  - --accent-light background
  - Icon + name + unlock date
  - Hover: slight lift animation
```

---

## Summary: The Aesthetic

**What makes this Apple-like:**
- Minimal color palette (1 primary + functional accents)
- Generous whitespace (16px padding, 24px gaps)
- Refined typography (tight letter spacing, system fonts)
- Subtle shadows (never harsh)
- Smooth, purposeful animations
- Invisible design (doesn't scream, just guides)
- Premium feel from restraint, not decoration
- Light/dark modes are native, not afterthought
- Clear information hierarchy

**Enterprise Polish Checklist:**
✓ Professional color scheme
✓ Consistent spacing grid
✓ Accessible contrast ratios
✓ Both light and dark themes
✓ Smooth interactions (no jarring)
✓ Scalable to any screen size
✓ Works for long sessions (eye comfort)
✓ Leadership/support team ready
