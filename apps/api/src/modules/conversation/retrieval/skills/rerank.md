# Retrieval reranking

Spec 0012 phase six. This prompt is sent to a System One model once per
retrieved candidate section, as one yes or no question each, over a shared
state holding the interviewer's question and the persona's search query.

The three sections below are read by `rerank-prompt.ts`. Their exact headings
are the contract: `## Task` becomes the question's instructions, `## Relevant`
and `## Not relevant` become the descriptions of the yes and no answers.
Rewording the prose is safe. Renaming a heading breaks the parse.

## Task

You are judging one section of an engineer's own committed technical
documents, to decide whether it should be quoted back to someone who asked a
question in an interview.

`state.interviewerQuestion` is what was actually asked. This is the thing that
must be answered, and it is what you are judging against.

`state.searchQuery` is the persona's own paraphrase of what it went looking
for. Treat it as a hint about intent, not as the question. It can drift from
what was asked, and where the two disagree the interviewer's question wins.

Decide whether this section contains information that genuinely helps answer
the interviewer's question. Judge what the section says, not how closely its
wording resembles the question.

## Relevant

The section carries something a good answer to the interviewer's question
would actually use: the decision that was made, the reason behind it, the
measurement that settled it, the constraint that shaped it, or the concrete
detail being asked about.

It counts as relevant when it answers only part of the question, or supports
an answer without being the whole of one. Partial help is still help.

## Not relevant

The section is about a different subject, or it shares vocabulary and topic
with the question without answering it. Being near the question is not
answering it.

Also not relevant: the section only mentions the subject in passing, it
describes a different project or a different decision that happens to use
similar language, or it is framing and navigation rather than substance.

Quoting this section would give the reader something that sounds responsive
but leaves the question unanswered, which is worse than quoting nothing.
