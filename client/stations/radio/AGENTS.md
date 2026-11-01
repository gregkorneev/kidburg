# Radio Station — mandatory agent instructions

## Required reading

Before implementing, modifying, reviewing, debugging, or integrating any Radio station behavior, AI logic, task state, content generation, teleprompter behavior, or Radio integration, you MUST read:

`docs/RADIO_AI_AGENT.md`

Read that document completely before making Radio-related changes.

`docs/RADIO_AI_AGENT.md` is the canonical product and AI-agent specification for the Radio station.

If current code conflicts with the specification:

1. identify the mismatch;
2. do not silently preserve the conflicting behavior;
3. either bring the implementation into compliance or explicitly report why the specification would need to change.

## Mandatory Radio invariants

- Radio AI runs locally.
- No cloud AI APIs.
- Reuse the project's existing Ollama/AI subsystem.
- The AI agent chooses `weather` or `science`; the player does not.
- The agent chooses the concrete topic.
- Science content originates from the curated local fact catalog.
- The LLM may rewrite science facts but may not invent additional facts, numbers, or unsupported causal claims.
- Weather content is fictional and educational and must not be presented as real weather.
- Recently used science topics should be avoided.
- The complete script is generated before broadcast.
- The player sees the complete script before broadcast.
- The player selects teleprompter speed before broadcast.
- During broadcast the teleprompter shows approximately 2–3 words at a time.
- ON AIR follows confirmed server task state and the countdown.
- Radio remains playable through local fallback content when Ollama is unavailable.

For the complete architecture, lifecycle, memory model, fallback rules and rationale, read:

`docs/RADIO_AI_AGENT.md`
