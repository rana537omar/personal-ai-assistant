---
name: find-a-venue
description: Find and compare places nearby — tennis or padel courts, restaurants, gyms, venues — with availability and booking links
---

1. Pin down what, where (`recall` "home city neighbourhood" if they didn't say), when, how many people, and budget.
2. `web_search` for options ("padel court near <area> book", "<cuisine> restaurant <area> reservation"). Read 2–4 promising pages with `web_fetch`.
3. For live availability, use `browser`: open the booking page, set date/time/party size, then `read` the results. Don't create accounts, sign in or pay.
4. Reply with a short comparison: name · area · price · availability you saw · booking link. Recommend one.
5. To book: give the exact steps or deep link and let the user confirm and complete it. Offer a `schedule_task` reminder before the slot.
