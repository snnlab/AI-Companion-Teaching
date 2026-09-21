# Decision Log

Append-only. Entries are timestamped and written **as decisions happen**. Never backfill at the end of a session; never rewrite an existing entry. The log's value is that it records what actually happened, when it happened. Late-captured entries are allowed only through `/aict:sync` and must carry the `(late-captured at sync)` label.

Append an entry when:

- Claude asks the student a clarifying question
- The student gives instructions that set scope or change course
- Claude makes a non-trivial interpretive call during execution (flag it, even without explicit sign-off)
- A result surprises someone, and the surprise changes what happens next

If unsure whether to log something: log it.

<!-- Entries go below, newest last. Format:

## YYYY-MM-DD HH:MM

**Context:** what was happening
**Question (Claude):** the question asked
    (or **Decision (Claude):** when flagging an unprompted interpretive call)
**Response (student):** what the student said
**Effect on execution:** what changed as a result

-->
