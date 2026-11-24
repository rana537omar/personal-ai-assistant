---
name: price-watch
description: Watch a product price (or any value on a page) on a schedule and tell the user when it changes
---

Setting it up:
1. Get the product URL and the condition (e.g. "below 250", "any drop", "back in stock").
2. `web_fetch` the page now and find the current price. If the page is dynamic, use `browser` open + read.
3. Save the baseline: `write_file` `watch/<short-name>.md` with the URL, condition and current price.
4. `schedule_task` with when "every day at 9am" (or what they ask) and what:
   "Price watch <short-name>: read watch/<short-name>.md, check the URL, compare with the condition. If it is met or the price changed, tell the user the old and new price with the link and update the file. Otherwise reply NO_REPLY."
5. Confirm to the user what is watched, how often, and how to stop it (cancel_scheduled with the id).
