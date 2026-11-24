---
name: summarize-link
description: Read a link the user shares and summarize it (article, page, docs, thread)
---

1. `web_fetch` the URL. If it fails or comes back empty, try `browser` with action `open`.
2. Summarize in this shape:
   - **One line**: what it is and the main point.
   - **Key points**: 3–6 bullets with concrete facts, numbers and names.
   - **Why it matters to them**: one line, using what you remember about the user (skip if nothing fits).
3. If they asked a specific question about the link, answer that first.
4. Offer to keep it: `todo_add` ("Read later: …") or `remember` if it's about their work.
