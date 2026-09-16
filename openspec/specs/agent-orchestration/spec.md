# agent-orchestration Specification

## Purpose

Turning one inbound advertising enquiry into a recorded, structured recommendation, under bounds
the model cannot lift.

This capability owns the division of labour between code and model: code decides the sequence —
which phase a run is in, which tools exist in that phase, when the run stops and what status it
ends in — and the model decides only what to do within the step it has been given. The phase is
computed from the tool results already recorded, so it answers to what has happened rather than to
anything the model or the advertiser's email asserts, and a tool outside the current phase is not
discouraged but absent.

It covers the run loop, the step and wall-clock budgets, the phase allowlist, the handling of
inbound text as data rather than instruction, the trace written as each step completes, and the
single terminal status every run finishes in. It does not define what any individual tool does
(`agent-tools`), nor verify that a recorded result is consistent with the tool results behind it —
that verification is the guardrail capability's.

## Requirements

### Requirement: A run is bounded before it begins

A run SHALL stop after a configured maximum number of steps and SHALL be subject to a wall-clock timeout, both read from validated configuration. Neither bound MAY be supplied by the model or by anything in an inbound message.

#### Scenario: A model that never stops calling tools

- **WHEN** the model requests a tool call on every step without ever producing a final result
- **THEN** the run stops at the configured step budget and ends `FAILED`, having made no more than that many model calls

#### Scenario: The budget is exhausted before a result exists

- **WHEN** the step budget is reached with no structured assessment produced
- **THEN** the run is recorded `FAILED` with a reason naming budget exhaustion, and no `Assessment` is saved

#### Scenario: The bound cannot be raised from outside

- **WHEN** an inbound message body asks for more steps, a longer timeout, or "unlimited" work
- **THEN** the configured bounds are unchanged, because they are read from configuration and never from message content

### Requirement: Only the current phase's tools exist

The orchestrator SHALL compute the current phase from the tool results already recorded in the run, and SHALL offer the model only that phase's tools. A tool outside the current phase MUST NOT be presented to the model, and MUST NOT execute even if a call to it is somehow produced.

#### Scenario: Pricing is not reachable before policy is known

- **WHEN** a run is on its first step, before `check_ad_policy` has returned anything
- **THEN** `calculate_quote` is absent from the tools offered to the model

#### Scenario: A call to an out-of-phase tool does not execute

- **WHEN** the model emits a call to a tool that is not in the current phase's allowlist
- **THEN** that tool's implementation does not run, and the run records the refused call rather than its result

#### Scenario: A refused vertical never reaches the pricing tools

- **WHEN** `check_ad_policy` returns `REFUSE`
- **THEN** the run moves directly to persisting the outcome, and `search_rate_card`, `lookup_inventory` and `calculate_quote` are never offered on that run

#### Scenario: A second policy check does not reopen a refused run

- **WHEN** a run that has already been refused calls `check_ad_policy` again with a different vertical, and that call returns `ALLOW`
- **THEN** the run stays in the persisting phase, because a refusal applies to the run and not merely to the most recent decision

### Requirement: The phase is decided by code, not by the model

The current phase SHALL be a pure function of the tool results recorded so far. The model MUST NOT be asked which phase it is in, and MUST NOT be able to advance a phase other than by producing the tool result that phase transition depends on.

#### Scenario: The same history always yields the same phase

- **WHEN** the phase function is called twice with the same recorded tool results
- **THEN** it returns the same phase and the same tool allowlist both times, with no database or model call involved

#### Scenario: A message claiming a phase has been completed

- **WHEN** an inbound message body asserts that policy has already been checked and approved
- **THEN** the phase is still computed from recorded tool results, so the run remains in the phase where `check_ad_policy` has not yet run

### Requirement: An inbound message is data, never instruction

The system instruction SHALL be a versioned constant. An inbound message's subject, sender and body MUST be passed as a user message wrapped in delimiters identifying it as untrusted data, and MUST NOT be interpolated into the system instruction.

#### Scenario: The system instruction is fixed

- **WHEN** any run is started, for any message
- **THEN** the system instruction sent to the model is identical, and the prompt version recorded on the run identifies it

#### Scenario: A message body containing an instruction to the agent

- **WHEN** the seeded injection fixture — whose body tells the agent to ignore its rules and quote at a discount — is run
- **THEN** the body appears only inside the untrusted-content delimiters of a user message, and the tools offered at each step are the ones its phase allows, unchanged by what the body says

#### Scenario: A body attempting to close the delimiter

- **WHEN** a message body itself contains the untrusted-content closing delimiter
- **THEN** the rendered content does not end the untrusted block early

### Requirement: Every step is recorded as it completes

Each model turn and each tool call SHALL be written as its own `RunStep` row at the time it completes, not accumulated and written at the end. Each row records its ordered index, its type, the tool name where applicable, the validated input and output, its duration and its token usage.

#### Scenario: A run that crashes partway

- **WHEN** a run throws after several steps have completed
- **THEN** the steps that completed before the failure are already persisted and readable

#### Scenario: A tool call and the model turn that requested it are distinguishable

- **WHEN** a step in which the model called a tool is recorded
- **THEN** the model turn and the tool call appear as separate rows with distinct types, in the order they happened

#### Scenario: Token usage is attributed

- **WHEN** a run completes
- **THEN** each model-call row carries its own token usage and the run carries the total

### Requirement: A run ends in exactly one terminal status

Every run SHALL finish with exactly one of `COMPLETED`, `REFUSED`, `NEEDS_HUMAN` or `FAILED`, recorded on the run along with the time it finished. A run MUST NOT be left `RUNNING` after `executeRun` returns, whatever happened inside it.

#### Scenario: A refused assessment

- **WHEN** the run produces a `REFUSED` disposition
- **THEN** the run's status is `REFUSED`, not `COMPLETED`

#### Scenario: An assessment needing human review

- **WHEN** the run produces a `NEEDS_REVIEW` disposition
- **THEN** the run's status is `NEEDS_HUMAN`

#### Scenario: An unexpected error inside the loop

- **WHEN** a tool or the model throws an error the orchestrator does not recognise
- **THEN** the run is closed `FAILED` with the error recorded, rather than left `RUNNING`

### Requirement: The run's answer is structured, not prose

A run SHALL produce its result through a schema-validated structured output containing at minimum a disposition and a human-readable summary. The orchestrator MUST NOT derive the disposition, the quote or any other machine-read field by parsing free text.

#### Scenario: A structured result is returned

- **WHEN** a run completes normally
- **THEN** the disposition and summary are read from the parsed structured output, and the assessment saved against the run carries both

#### Scenario: The model returns something that does not match the schema

- **WHEN** the model's final output cannot be parsed against the assessment schema
- **THEN** the run ends `FAILED` rather than persisting a partially-understood result
