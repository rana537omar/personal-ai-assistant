---
name: trip-planner
description: Plan a trip or a journey home — train/flight/bus options, times, prices, and an itinerary
---

1. Collect the basics. Ask only for what's missing and essential: from, to, dates, number of travellers. Check memory first (`recall` "travel preferences home city") — seat preferences, usual station, budget.
2. Research options with `web_search` / `web_fetch` (operator sites, official timetables). Use `browser` for booking sites that need a form: fill in from/to/date and read the results. Never sign in or pay.
3. Present 2–3 options in a compact list: departure → arrival, duration, changes, price if shown, and a link to book.
4. Recommend one and briefly say why (fits their preferences, cheapest, or fastest).
5. Booking: give the direct link and what to select. **Do not purchase** — the user completes payment themselves.
6. Offer follow-ups: `schedule_task` a reminder to leave or check in, `todo_add` for things to pack or book.
