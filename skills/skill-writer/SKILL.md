---
name: skill-writer
description: Create a new reusable skill when the user teaches you a workflow they will ask for again
---

Use when the user says "every time I ask X, do Y", or after you have worked out a multi-step process together that they will repeat.

1. Name: short, lowercase-with-dashes, describing the task (e.g. `expense-report`, `invoice-chaser`).
2. Description: one line saying *when* to use it.
3. Instructions (Markdown), kept short:
   - Inputs to collect (ask only for what is missing; check memory first).
   - Numbered steps naming the exact tools to use.
   - The output format.
   - Safety lines: what never to do (pay, message other people, delete) without explicit confirmation.
4. Show the draft to the user, then call `create_skill`. Tell them it is saved and how to trigger it.
