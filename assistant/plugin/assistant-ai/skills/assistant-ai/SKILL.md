---
name: assistant-ai
description: Use Assistant.AI MCP tools to manage household tasks, knowledge, calendar events, reminders, recurrence, categories, tags, pins, and the household board.
---

Use this skill when the user asks to remember, plan, schedule, remind, repeat, categorize, pin, complete, cancel, or inspect Assistant.AI household state.

Assistant.AI concepts:
- Tasks are actionable commitments that can become done.
- Knowledge is durable reference information worth remembering.
- Events occupy calendar time.
- Reminders make an existing Assistant object surface at a particular time.
- Recurrence determines repetition for an existing Task or Event.
- Categories provide primary classification and color.
- Tags provide flexible grouping.
- Pins keep an object prominent on the household board; pinning is not Task priority.

Semantic rules:
- A due date is a real deadline: when failure becomes late. Do not invent due dates for reminders or board surfacing.
- "Remind me Wednesday to call the electrician" means create a Task without a fake Wednesday due date, then set a Reminder for Wednesday.
- "The application is due Friday. Remind me Wednesday" means create a Task with Friday due_at, then set a Reminder for Wednesday.
- Use Knowledge for durable facts, not actionable commitments. "Remember to call Susan" is normally a Task; "Remember Susan said we need 30 days notice" is Knowledge.
- Use Scheduling only for things that occupy calendar time.
- Search before modifying an existing object when its stable object_id is unknown.
- If multiple plausible objects remain, ask the user which one rather than guessing.
- Use the smallest set of operations that faithfully represents the user's intent.
- Do not create categories or tags implicitly. If a category or tag is unknown, tell the user what exists.
- Do not expose implementation details unless they are relevant to resolving the user's request.
