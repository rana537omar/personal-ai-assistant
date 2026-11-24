# Skills

Skills are reusable playbooks. Each one is a folder containing a `SKILL.md` file:

```
skills/
  trip-planner/
    SKILL.md
```

```markdown
---
name: trip-planner
description: Plan a trip or a journey home — train/flight/bus options, times, prices, and an itinerary
---

1. Collect the basics: from, to, dates, travellers. Check memory first (`recall` "travel preferences").
2. Research with `web_search` / `web_fetch`; use `browser` for booking forms. Never sign in or pay.
3. Present 2–3 options with links. Recommend one.
4. Offer a `schedule_task` reminder to leave.
```

## How the assistant uses them

The system prompt lists every enabled skill as `name: description`. When a request matches, the model calls `use_skill(name)` and receives the full instructions as a tool result, then follows them. Only the short index costs context on every turn, so you can have many skills.

## Where they live

- **Bundled** skills ship in `skills/` (in the repository).
- **Your** skills live in `data/skills/<name>/SKILL.md`. A custom skill with the same name as a bundled one overrides it — that's how "customise" in the web app works, and deleting the custom copy restores the built-in version.
- Disable any skill with its toggle on the Skills page.

## Writing good skills for local models

Small models follow short, concrete instructions best:

- Keep it under ~25 lines.
- Number the steps and name the exact tools (`web_search`, `todo_add`, …).
- Say what to ask the user for, and to check memory before asking.
- Describe the output format.
- Include the safety line for anything involving money, other people or deletion: *prepare it, then let the user confirm or finish it.*

## Let the assistant write them

Say something like *"Every Friday I want you to pull my open to-dos and draft a status update for my team — save that as a skill."* The bundled `skill-writer` skill guides it to draft one, show it to you, and save it with `create_skill` (which needs your approval in Ask mode).

## Scheduled skills

Skills combine well with schedules: *"Every weekday at 8am, use the daily-briefing skill."* The `price-watch` skill shows a pattern for scheduled jobs that should stay quiet unless something changed — the job replies `NO_REPLY` and nothing is delivered.
