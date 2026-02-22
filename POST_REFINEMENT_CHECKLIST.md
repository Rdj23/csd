# Post-Refinement Verification Checklist

After Claude Code refines your dashboard, use this checklist to verify everything is enterprise-premium quality.

---

## VISUAL INSPECTION

### Navigation & Tabs
- [ ] Active tab has blue underline (2px --primary)
- [ ] Tab text is 14px / 500 weight
- [ ] Inactive tabs show --text-secondary (muted gray)
- [ ] Hover state on inactive tabs is smooth
- [ ] No jarring color changes
- [ ] All 6 tabs visible (Ongoing, All, CSD, My Views, Analytics, Gamification)

### Metric Cards (Top Row)
- [ ] Numbers are clearly visible and bold
- [ ] Numbers are monospace font (precise look)
- [ ] Titles are small and muted (12px / 500 / gray)
- [ ] Cards have subtle 1px border (not thick)
- [ ] Card shadows are very subtle (not dark/harsh)
- [ ] Padding inside cards is equal on all sides (16px)
- [ ] Hover effect: card lifts slightly with shadow increase
- [ ] Trend indicators (if present) show correct colors

### Filter Buttons
- [ ] All filter buttons visible (All Time, Team, Member, Region, etc)
- [ ] Inactive buttons: gray background, gray border
- [ ] Active buttons: blue background (#0066CC), white text
- [ ] Button height is 36px (not too small, not too big)
- [ ] Button padding is consistent (10px 18px)
- [ ] Buttons have 8px radius (not sharp corners, not too rounded)
- [ ] Hover state is smooth (background shifts, no jump)
- [ ] Buttons don't crowd (8px gap between each)

### Primary Buttons (Save View, Filter, Logout)
- [ ] Same styling as filter buttons (blue background, white text)
- [ ] Height: 36px
- [ ] Padding: 10px 18px
- [ ] Font: 14px / 500
- [ ] Hover: darker blue (#0052A3)
- [ ] Transitions smooth (no instant flashing)

### Data Table (Ticket List)
- [ ] Header row has light background (--bg-secondary)
- [ ] Header text is uppercase and small (12px / 500)
- [ ] Header has 0.5px letter-spacing (data style)
- [ ] Data rows have white background (light mode) or dark (dark mode)
- [ ] Rows have thin border at bottom (not thick)
- [ ] Row hover: light gray highlight on background
- [ ] Ticket IDs are blue (link color, clickable)
- [ ] Numbers are monospace (exactly aligned)
- [ ] Column spacing is consistent
- [ ] No horizontal scroll (unless needed)

### Status Badges
- [ ] **Success** (Healthy): Green background + green text
- [ ] **Warning** (Attention): Orange background + orange text
- [ ] **Danger** (Action): Red background + red text
- [ ] Badge padding is consistent (4px 8px)
- [ ] Badge border-radius is 6px (not square, not too round)
- [ ] Text is 12px / 500 weight
- [ ] Colors match system exactly (no custom shades)

### Charts (Pie, Line, Bar)
- [ ] Chart colors from system palette only
- [ ] Grid lines are very faint (barely visible)
- [ ] Legend is visible and 12px text
- [ ] Title is 18px / 600 weight
- [ ] Container has 1px border and subtle shadow
- [ ] No harsh colors or gradients
- [ ] Tooltip appears on hover with dark background

### Leaderboard (CSAT Champions)
- [ ] Rank numbers visible (1, 2, 3, 4, 5...)
- [ ] Rank is monospace font (precisely aligned)
- [ ] Names are clear and readable (14px)
- [ ] **SCORES ARE WARM ORANGE (#FF6B35)** ← This is critical! Scores must POP!
- [ ] Scores are bold (14px / 700 weight)
- [ ] Scores should stand out immediately when you look at the section
- [ ] Medal icons visible for top 3 (🥇 🥈 🥉)
- [ ] Row hover: gentle background color shift
- [ ] No bold ranking symbols taking away from the orange scores

### Achievement Badges (Gamification)
- [ ] Badge background is warm (--accent-light, peachy)
- [ ] Badge border is warm orange (--accent, 2px)
- [ ] Icon is centered and properly sized (48px)
- [ ] Label is centered below icon (12px text)
- [ ] Multiple badges arranged in grid (3-4 per row)
- [ ] Hover: card lifts and grows slightly (scale 1.05)
- [ ] Hover: shadow increases
- [ ] Transition is smooth (150ms)

### Negative Feedback Section
- [ ] Background is light red/pink (--danger-light)
- [ ] Border is red (--danger)
- [ ] Title has warning icon (⚠️)
- [ ] Title color is red (--danger)
- [ ] Items are readable with icon bullets
- [ ] Action buttons (if present) are red/danger styled

---

## COLOR COMPLIANCE

### Light Mode
- [ ] Text headings: near-black (#1D1D1D)
- [ ] Secondary text: gray (#6B7280)
- [ ] Disabled text: lighter gray (#A0AEC0)
- [ ] Backgrounds: white (#FFFFFF) or light gray (#F5F7FA)
- [ ] Borders: subtle gray (#E5E7EB)
- [ ] Primary blue: #0066CC (buttons, links, active states)
- [ ] No purple, pink, or non-system colors visible

### Dark Mode
- [ ] Text headings: off-white (#F8FAFC)
- [ ] Secondary text: muted light (#CBD5E0)
- [ ] Disabled text: muted lighter (#A0AEC0)
- [ ] Backgrounds: very dark (#0F1419) or dark-gray (#1A202C)
- [ ] Borders: dark gray (#2D3748)
- [ ] Primary blue: brighter blue (#3B82F6) in dark mode
- [ ] Same colors in same roles (blue is still primary, green is still success)

### System Colors Used Correctly
- [ ] Success (green): #34C759 ✓
- [ ] Warning (orange): #FF9500 ✓
- [ ] Danger (red): #FF3B30 ✓
- [ ] Accent (warm orange): #FF6B35 ✓ (especially in leaderboard)
- [ ] Primary (blue): #0066CC ✓
- [ ] No random colors (lime, cyan, pink, purple) ✓

---

## SPACING VERIFICATION

### Padding
- [ ] Card padding: 16px (all sides)
- [ ] Button padding: 10px (top/bottom) x 18px (left/right)
- [ ] Table cell padding: 12px (horizontal) x 8px (vertical)
- [ ] Metric card padding: 20px (generous space)
- [ ] Filter group padding: 8px gaps between buttons

### Margins & Gaps
- [ ] Section gaps: 24px (between major sections)
- [ ] Component gaps: 8px (between buttons, small elements)
- [ ] Chart grid: 16px gap between charts
- [ ] Leaderboard row gaps: consistent (not cramped, not sparse)

### No Random Values
- [ ] No padding like 15px, 17px, 19px, 21px
- [ ] No margins like 10px, 13px, 18px, 22px
- [ ] All spacing is 4px-aligned (4, 8, 12, 16, 20, 24, 28, 32)
- [ ] Audit CSS/style for any non-grid values

---

## TYPOGRAPHY CHECK

### Sizes (ONLY these values)
- [ ] Page title: 32px ✓
- [ ] Section title: 24px ✓
- [ ] Card title: 18px ✓
- [ ] Subtitle: 14px or smaller ✓
- [ ] Body text: 14px ✓
- [ ] Small text: 12px ✓
- [ ] **NO sizes like 13px, 15px, 16px, 17px, 19px, 20px, 22px, 26px, 28px** ✗

### Weights (ONLY these values)
- [ ] Regular text: 400 weight ✓
- [ ] Medium text: 500 weight ✓
- [ ] Semibold text: 600 weight ✓
- [ ] Bold text: 700 weight ✓
- [ ] **NO weights like 300, 350, 450, 550, 650** ✗

### Hierarchy
- [ ] Metric numbers are largest (32px) and boldest (700)
- [ ] Metric titles are smaller (12px) and lighter (500)
- [ ] Body text is clear (14px / 400)
- [ ] Small text is readable (12px minimum)
- [ ] No text smaller than 12px

### Font Family
- [ ] Font is Inter or system fonts ✓
- [ ] Monospace for numbers (SF Mono, Monaco) ✓
- [ ] Consistent across all components ✓

---

## INTERACTION VERIFICATION

### Transitions
- [ ] Button hover: smooth transition (no instant color flash)
- [ ] Tab switch: smooth underline movement
- [ ] Table row hover: smooth background change
- [ ] All transitions: 150ms or similar (not instant 0ms)
- [ ] All transitions: ease-out (not linear, not ease-in)

### Hover States
- [ ] Buttons: color changes smoothly
- [ ] Cards: subtle shadow lift (not jerky)
- [ ] Rows: light highlight (not bright flash)
- [ ] All hovers are subtle (not jarring)

### Click States
- [ ] Buttons: slight scale down (0.98) for press feel
- [ ] Links: color change on click
- [ ] No visual lag or delay
- [ ] Clear feedback on interaction

### No Jarring Animations
- [ ] No bounce effects
- [ ] No fade-ins/outs (unless intentional)
- [ ] No spinning or rotating elements
- [ ] No excessive shadows or glows

---

## DARK MODE VERIFICATION

### Text Contrast
- [ ] Dark mode text is readable (light color on dark background)
- [ ] Use contrast checker: minimum 4.5:1 ratio
- [ ] White text (#FFFFFF) on dark background (#0F1419) ✓
- [ ] Off-white text (#F8FAFC) on dark background ✓
- [ ] No dark text on dark background ✗

### Component Styling
- [ ] Cards have dark background (not light)
- [ ] Buttons maintain correct styling
- [ ] Badges use correct dark-mode colors
- [ ] Charts visible with dark background
- [ ] Borders visible (not black on black)

### Color Swaps
- [ ] Background colors inverted ✓
- [ ] Text colors inverted ✓
- [ ] Accent colors maintained (still pop) ✓
- [ ] Border colors adjusted for visibility ✓

### Same Structure
- [ ] Spacing identical to light mode ✓
- [ ] Typography identical to light mode ✓
- [ ] Layout identical to light mode ✓
- [ ] Only colors change ✓

---

## ACCESSIBILITY CHECK

### Font Size Minimums
- [ ] No text below 12px ✓
- [ ] All text is readable at normal viewing distance ✓
- [ ] Labels are minimum 12px ✓

### Contrast Ratios
- [ ] All text: 4.5:1 minimum (WCAG AA) ✓
- [ ] Use color contrast checker tool
- [ ] Check both light AND dark modes
- [ ] Interactive elements: 3:1 minimum ✓

### Focus States
- [ ] Keyboard navigation has visible focus border ✓
- [ ] Focus indicators not removed or hidden ✗
- [ ] Focus color contrasts with background ✓

### Color Independence
- [ ] Don't rely on color ONLY (use icons too)
- [ ] Success: green + checkmark ✓
- [ ] Warning: orange + alert icon ✓
- [ ] Danger: red + X icon ✓

### Keyboard Navigation
- [ ] Can tab through all interactive elements ✓
- [ ] Tab order makes sense ✓
- [ ] Can activate buttons with Enter/Space ✓

---

## COMPLETENESS CHECK

### All Features Present
- [ ] Ongoing Tickets tab working ✓
- [ ] All Tickets tab working ✓
- [ ] CSD Highlighted tab working ✓
- [ ] My Views tab working ✓
- [ ] Analytics tab working ✓
- [ ] Gamification tab working ✓

### All Components Refined
- [ ] Navigation styled ✓
- [ ] Metric cards refined ✓
- [ ] Filters styled ✓
- [ ] Buttons polished ✓
- [ ] Tables refined ✓
- [ ] Badges colored correctly ✓
- [ ] Charts looking good ✓
- [ ] Leaderboard scores pop ✓
- [ ] Achievements styled ✓
- [ ] Negative feedback section polished ✓

### No Broken Elements
- [ ] No overlapping elements ✗
- [ ] No cut-off text ✗
- [ ] No invisible text ✗
- [ ] All images/icons visible ✓
- [ ] All buttons clickable ✓
- [ ] No console errors ✓

---

## PROFESSIONAL POLISH

### Overall Aesthetic
- [ ] Dashboard looks premium/enterprise-level ✓
- [ ] Resembles Apple design (minimal, refined) ✓
- [ ] Not playful or cartoonish ✓
- [ ] Professional and trustworthy ✓

### Consistency
- [ ] Spacing consistent throughout ✓
- [ ] Colors used consistently ✓
- [ ] Typography hierarchy clear ✓
- [ ] No random design decisions ✓

### Details
- [ ] Shadows are subtle (not harsh) ✓
- [ ] Borders are thin (not bold) ✓
- [ ] Spacing is balanced (not cramped, not sparse) ✓
- [ ] Typography is readable ✓

### User Experience
- [ ] Interactions feel smooth ✓
- [ ] Hover states are helpful ✓
- [ ] Active states are clear ✓
- [ ] Loading states (if any) are smooth ✓

---

## FINAL TESTING

### Browser Testing
- [ ] Chrome/Edge ✓
- [ ] Firefox ✓
- [ ] Safari ✓
- [ ] Mobile browser ✓

### Responsive Testing
- [ ] Desktop (1920px+) ✓
- [ ] Laptop (1280px) ✓
- [ ] Tablet (768px) ✓
- [ ] Mobile (375px) ✓

### Data Testing
- [ ] With sample data ✓
- [ ] With minimal data ✓
- [ ] With large datasets ✓
- [ ] With missing data ✓

### Theme Testing
- [ ] Light mode throughout ✓
- [ ] Dark mode throughout ✓
- [ ] Theme toggle works ✓
- [ ] No theme flashing ✓

---

## SIGN-OFF

When ALL checkboxes are checked:

✅ **ENTERPRISE-PREMIUM DASHBOARD COMPLETE**

You can confidently say:
- "Dashboard is production-ready"
- "Meets design system specifications"
- "Professional, Apple-like aesthetic"
- "Accessible and performant"
- "Leadership-ready quality"

---

## If Anything Fails

**Checkbox not passed?** → Go back to Claude Code and ask:

```
"[Feature] still isn't quite right. [Specific issue].

Can you refine just this component to [specific requirement]?"
```

Claude Code will fix specific issues without redoing everything.

---

## Common Fixes for Failed Checks

**Issue:** Leaderboard scores don't stand out
**Fix:** Ask Claude Code to make them brighter and bigger (#FF6B35, 14px/700)

**Issue:** Dark mode text is hard to read
**Fix:** Increase text brightness (#F8FAFC instead of #F0F0F0)

**Issue:** Spacing feels inconsistent
**Fix:** Audit with inspector, replace all custom spacing with system grid

**Issue:** Some colors look wrong
**Fix:** List exact hex codes from DESIGN_SYSTEM.md, ask Claude Code to replace

**Issue:** Transitions feel jerky
**Fix:** Change all to 150ms ease-out, remove instant 0ms changes

**Issue:** Hover states not working
**Fix:** Verify CSS is applied, test in browser with hover/active pseudo-classes

---

## Success Looks Like

After passing all checks:

✨ **Dashboard feels premium**
✨ **Spacing is consistent throughout**
✨ **Colors coordinate beautifully**
✨ **Typography hierarchy is clear**
✨ **Interactions are smooth**
✨ **Light and dark modes both work**
✨ **Leadership will be impressed**

**Congratulations! You've built an enterprise-premium dashboard.**
