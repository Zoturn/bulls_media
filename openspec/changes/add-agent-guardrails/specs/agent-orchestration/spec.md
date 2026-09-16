## MODIFIED Requirements

### Requirement: A run ends in exactly one terminal status

Every run SHALL finish with exactly one of `COMPLETED`, `REFUSED`, `NEEDS_HUMAN` or `FAILED`, recorded on the run along with the time it finished. A run MUST NOT be left `RUNNING` after `executeRun` returns, whatever happened inside it.

That status SHALL be derived from the model's disposition only after code has had the last word: a `REFUSE` on record makes the run `REFUSED` regardless of the disposition, and a post-condition violation makes it `FAILED` rather than letting a contradicted claim set it.

#### Scenario: A refused assessment

- **WHEN** the run produces a `REFUSED` disposition
- **THEN** the run's status is `REFUSED`, not `COMPLETED`

#### Scenario: An assessment needing human review

- **WHEN** the run produces a `NEEDS_REVIEW` disposition
- **THEN** the run's status is `NEEDS_HUMAN`

#### Scenario: An unexpected error inside the loop

- **WHEN** a tool or the model throws an error the orchestrator does not recognise
- **THEN** the run is closed `FAILED` with the error recorded, rather than left `RUNNING`

#### Scenario: A disposition the tool results contradict

- **WHEN** the model returns a disposition that a post-condition rejects
- **THEN** the run is closed `FAILED` with the violation recorded, rather than `COMPLETED` on the model's say-so

#### Scenario: A policy refusal outranks the model's disposition

- **WHEN** `check_ad_policy` returned `REFUSE` and the model returns any other disposition
- **THEN** the run's status is `REFUSED`
