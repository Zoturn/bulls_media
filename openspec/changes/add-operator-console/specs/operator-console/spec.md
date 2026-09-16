## ADDED Requirements

### Requirement: The inbox lists every inbound message with its current state

The inbox SHALL list every seeded inbound message, newest first, showing whether a case has been
opened for it and, if a run has been started, that run's status. It MUST NOT require a case to
exist before a message is visible.

#### Scenario: A message with no case yet

- **WHEN** an inbound message has never been opened
- **THEN** it appears in the inbox with no case and no run status

#### Scenario: A message whose case has a run in progress

- **WHEN** a case has a `RUNNING` run
- **THEN** the inbox shows that run's status for the message, not merely that a case exists

#### Scenario: An empty inbox

- **WHEN** no inbound messages exist
- **THEN** the inbox renders a state explaining there is nothing waiting, not an empty list with no explanation

### Requirement: Opening a message is idempotent

Opening an inbound message SHALL create its case if none exists and otherwise return the case
that already does, so an operator can click the same message twice without effect.

#### Scenario: Opening the same message twice

- **WHEN** a message is opened, and then opened again
- **THEN** both requests resolve to the same case id, and only one case row exists for that message

#### Scenario: Opening a message that does not exist

- **WHEN** the given message id matches no inbound message
- **THEN** the request is rejected with `NOT_FOUND`, not a database error

### Requirement: A run starts without the request waiting for it to finish

Starting a run for a case SHALL create the run and respond as soon as it exists, before the model
has produced anything. The console MUST learn the outcome by reading the case afterward, not by
the start request blocking until one is available.

#### Scenario: Starting a run responds before the run finishes

- **WHEN** a run is started for a case with no run in progress
- **THEN** the response carries the new run's id and arrives before that run reaches a terminal status

#### Scenario: A second run is rejected while one is active

- **WHEN** a run is started for a case that already has a `RUNNING` run
- **THEN** the request is rejected with `RUN_IN_PROGRESS`, and no second run is created

#### Scenario: Starting a run with no model configured

- **WHEN** no model provider key is configured
- **THEN** the request is rejected with `MODEL_NOT_CONFIGURED` rather than hanging or failing as an unexplained server error

#### Scenario: Starting a run for a case that does not exist

- **WHEN** the given case id matches no case
- **THEN** the request is rejected with `NOT_FOUND`

### Requirement: A case's detail reflects its most recent run as it happens

Reading a case SHALL include its inbound message and its most recent run, with every step
recorded on that run so far, its assessment if one has been saved, and any approval decision. A
run still `RUNNING` MUST be readable mid-flight, showing the steps completed to that point.

#### Scenario: Reading a case with a run in progress

- **WHEN** a case's latest run has completed three of an eventual six steps
- **THEN** reading the case returns exactly those three steps and a `RUNNING` status

#### Scenario: Reading a case with no run yet

- **WHEN** a case has never had a run started
- **THEN** reading it succeeds and reports no run, rather than an error

#### Scenario: Reading a case that does not exist

- **WHEN** the given case id matches no case
- **THEN** the request is rejected with `NOT_FOUND`

### Requirement: A refused or contradicted run shows why, not merely its status

Case detail SHALL surface the evidence a terminal run carries: the policy rule and vertical behind
a refusal, and any post-condition violation recorded against the run's structured answer.

#### Scenario: A refused case names its rule

- **WHEN** a run's status is `REFUSED`
- **THEN** the case detail includes the policy rule id and the vertical that produced the refusal

#### Scenario: A contradicted answer shows the violation

- **WHEN** a run recorded a post-condition violation
- **THEN** the case detail includes what was claimed and what the tool results actually said, not only that the run failed

### Requirement: An operator decides once, and the decision is never shown before the server confirms it

Recording an approval decision SHALL succeed exactly once per run and MUST require who made the
decision. A decision already recorded on a run MUST NOT be silently replaced by a second one.

#### Scenario: Approving a completed run

- **WHEN** a run has a saved assessment and no decision yet
- **THEN** an approval request with a decision and a name succeeds, and the case it belongs to is resolved

#### Scenario: Deciding the same run twice

- **WHEN** a run already has a recorded decision
- **THEN** a second approval request is rejected with a specific code, and the first decision is unchanged

#### Scenario: A decision with no name

- **WHEN** an approval request omits who is deciding
- **THEN** it is rejected with `VALIDATION_ERROR` naming the missing field, and nothing is recorded

### Requirement: Every endpoint validates its input and answers with the shared envelope

Every route under this capability SHALL validate its request body or parameters before doing any
work, and SHALL answer an invalid or unresolvable request with the project's error envelope —
`{ error: { code, message, fieldErrors? } }` — never a raw exception.

#### Scenario: A malformed approval request

- **WHEN** an approval request's `decision` is not one of the recognised values
- **THEN** the response is `VALIDATION_ERROR` with a field-level breakdown, not a 500

#### Scenario: An unresolvable resource is reported the same way regardless of why

- **WHEN** a request names a case or run id that does not exist
- **THEN** the response is `404 NOT_FOUND`, not `403`, so the endpoint does not confirm that a hidden resource exists
