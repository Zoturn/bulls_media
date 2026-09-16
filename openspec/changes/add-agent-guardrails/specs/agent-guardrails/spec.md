## ADDED Requirements

### Requirement: A claim is checked against the tool results behind it

Before an assessment is recorded, the system SHALL compare what it claims against the tool results actually recorded on that run. The comparison MUST be a pure function of the claim and the recorded results, with no model call and no second opinion from the model about its own work.

#### Scenario: A quoted total that does not match the calculation

- **WHEN** an assessment claims a total that differs from what `calculate_quote` returned on that run
- **THEN** the claim is rejected with a violation naming both totals, and no `Assessment` row is written

#### Scenario: A quote with no calculation behind it at all

- **WHEN** an assessment claims a `QUOTED` disposition on a run where `calculate_quote` never returned a successful result
- **THEN** the claim is rejected, because a price with no tool result behind it is a price the model invented

#### Scenario: A refused case carrying a price

- **WHEN** an assessment claims a `REFUSED` disposition and also carries a quote
- **THEN** the claim is rejected rather than silently stripped, so the contradiction is recorded instead of tidied away

#### Scenario: A vertical that was never assessed

- **WHEN** the vertical in the extracted brief is not the vertical any `check_ad_policy` call on that run was asked about
- **THEN** the claim is rejected, because the policy decision on record answers a different question from the one the assessment reports

#### Scenario: A claim that matches its tool results

- **WHEN** every claimed value agrees with the recorded tool results
- **THEN** no violation is produced and the assessment is recorded

### Requirement: Post-conditions are enforced wherever a claim becomes a record

The system SHALL run the same post-condition check at every boundary where a claimed assessment is turned into persisted state: when `save_case` writes the `Assessment` row, and when a run's terminal status is derived from the structured answer. A claim rejected at one boundary MUST NOT be accepted at the other.

#### Scenario: The write tool refuses a violating assessment

- **WHEN** the model calls `save_case` with a total that contradicts `calculate_quote`
- **THEN** the tool returns a failure naming the violations, no row is written, and the failure is recorded as a step the model can read

#### Scenario: The model corrects itself after a rejection

- **WHEN** the model calls `save_case` with a wrong total, receives the violation, and calls again with the total `calculate_quote` returned
- **THEN** the second call succeeds and the run completes

#### Scenario: The saved row and the returned answer disagree

- **WHEN** the model saves one disposition through `save_case` and returns a different one in its structured answer
- **THEN** the run does not complete as though the two agreed, and the disagreement is recorded

#### Scenario: Violations survive as evidence

- **WHEN** a run ends because a post-condition failed
- **THEN** the run records which check failed and what the recorded tool result actually said

### Requirement: Refusal is decided by the policy engine, not by the model

When `check_ad_policy` has returned `REFUSE` on a run, the run's terminal status SHALL be `REFUSED` whatever disposition the model reports. The model's agreement MUST NOT be a condition of the refusal taking effect.

#### Scenario: The model quotes anyway

- **WHEN** `check_ad_policy` returns `REFUSE` and the model nevertheless returns a `QUOTED` assessment
- **THEN** the run's status is `REFUSED`, no quote is recorded against it, and the contradiction is recorded

#### Scenario: The model reports the refusal itself

- **WHEN** `check_ad_policy` returns `REFUSE` and the model returns a `REFUSED` assessment
- **THEN** the run's status is `REFUSED` and no violation is raised, because code and model reached the same place

#### Scenario: A refusal explains itself

- **WHEN** a run is refused
- **THEN** the recorded outcome names the policy rule and the vertical that produced the decision, not merely that a refusal occurred

### Requirement: Inbound and retrieved text are both treated as untrusted

The system SHALL neutralise instruction-shaped content in every string that reaches the model from outside the system prompt — the inbound message's body, subject and sender, and the text of any retrieved rate-card or policy content. A document the operator seeded MUST NOT be exempt.

#### Scenario: An injection planted in seeded content

- **WHEN** a rate-card package's name or format contains the untrusted-content delimiter
- **THEN** the delimiter is neutralised before that text reaches the model, exactly as it would be in an email body

#### Scenario: An instruction in a subject line

- **WHEN** an inbound message's subject rather than its body carries the instruction
- **THEN** it is neutralised and delimited on the same path as the body

#### Scenario: An instruction in a sender's display name

- **WHEN** an inbound message's sender name carries the instruction
- **THEN** it is neutralised and delimited on the same path as the body

### Requirement: The injection corpus is asserted by behaviour

The system SHALL keep a corpus of injection attempts as deterministic seeded fixtures, covering at minimum an instruction in the body, an instruction in the subject, an instruction in a sender name, a forged delimiter, a claimed prior approval and a claimed policy exception. Tests over that corpus MUST assert on behaviour — which tools ran, what was recorded, which disposition resulted — and MUST NOT assert on the wording of any refusal.

#### Scenario: A message claiming the account is pre-approved

- **WHEN** the corpus fixture claiming prior approval is run
- **THEN** the policy tool still runs, the approval state is read from the database rather than from the message, and no quote exists that `calculate_quote` did not produce

#### Scenario: A message claiming a policy exception

- **WHEN** the corpus fixture claiming an exception to the prohibited-vertical policy is run against a refused vertical
- **THEN** the run is `REFUSED`

#### Scenario: A message carrying a forged delimiter

- **WHEN** the corpus fixture whose body contains the untrusted-content delimiter is run
- **THEN** the untrusted block is not terminated early and the tools offered at each step are unchanged

#### Scenario: No test asserts on refusal wording

- **WHEN** the refusal copy is reworded
- **THEN** the guardrail suite still passes, because it asserts on recorded behaviour rather than on sentences
