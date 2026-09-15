## ADDED Requirements

### Requirement: An enquiry and its processing are recorded separately

The system SHALL store an inbound message, the case opened from it, each run over that case, and each step of that run as distinct records. A run MUST belong to exactly one case, and a step to exactly one run. Deleting a case MUST remove its runs and their steps, leaving no orphaned records.

#### Scenario: A case is opened from an inbound message

- **WHEN** an inbound message is recorded and a case opened from it
- **THEN** the case references that message, and the message's body is stored once rather than copied onto the case

#### Scenario: Steps are ordered within their run

- **WHEN** several steps are recorded against one run
- **THEN** each has a distinct index within that run, and reading them back returns them in that order

#### Scenario: Removing a case removes its history

- **WHEN** a case with runs and steps is deleted
- **THEN** its runs and their steps are deleted with it, and no step remains referencing a run that no longer exists

### Requirement: The seed is deterministic

`npm run db:seed` SHALL produce identical records on every run and on every machine — the same ids, the same field values and the same timestamps. It MUST NOT use generated ids, the current clock, or randomness for any seeded value.

#### Scenario: Seeding twice produces the same data

- **WHEN** the database is reset and seeded, and then reset and seeded again
- **THEN** every seeded record has the same id and the same field values as on the first run

#### Scenario: A test can name a fixture

- **WHEN** a test refers to a seeded message or rate-card package by its id
- **THEN** that record exists with the values the test expects, without the test having to query for "the first" of anything

### Requirement: The seed covers the paths that can go wrong

The seed SHALL include, as inbound messages, at least: an ordinary complete brief; a brief in a prohibited vertical; a brief in a vertical requiring extra review; a message whose body contains an instruction addressed to the agent; a message that is not an advertising brief at all; and a brief missing the budget needed to quote.

#### Scenario: An adversarial fixture is available before any agent exists

- **WHEN** the seed has run
- **THEN** a message whose body attempts to instruct the agent is present and identifiable by id, so later changes can assert against it rather than inventing their own fixture

#### Scenario: A refusable enquiry is available

- **WHEN** the seed has run
- **THEN** at least one message is in a vertical the policy table marks as refused, and at least one in a vertical it marks as requiring review

### Requirement: Configuration is validated before the application serves anything

The environment SHALL be parsed and validated once, at module load, against a schema. A missing or malformed required setting MUST cause a startup failure naming the setting, rather than a failure later during a run.

#### Scenario: A required setting is absent

- **WHEN** the application starts with no `DATABASE_URL`
- **THEN** it fails immediately with an error naming `DATABASE_URL`

#### Scenario: A numeric limit is malformed

- **WHEN** `AGENT_MAX_STEPS` is set to a value that is not a positive integer
- **THEN** startup fails naming that setting, rather than the agent looping on a limit that silently became `NaN`

#### Scenario: The model key is absent

- **WHEN** the application starts with no `ANTHROPIC_API_KEY`
- **THEN** the application still starts and the console still serves, because the key is needed only to run the agent and the test suite must not require one

### Requirement: Secrets do not reach the browser or the logs

No configuration value holding a credential SHALL be readable from client-side code, and the logger MUST redact credential-bearing fields and the inbound message body at `info` level and above.

#### Scenario: A credential is requested from the browser bundle

- **WHEN** client-side code attempts to read the model API key
- **THEN** it is unavailable, because the value is server-only and never exposed through a public setting

#### Scenario: A message body is logged

- **WHEN** a log line is written at `info` carrying an inbound message
- **THEN** the body is redacted, so advertiser correspondence does not travel into the log pipeline

### Requirement: The service reports its own health

The system SHALL expose an endpoint reporting whether it can reach its database, answering with the shared error envelope when it cannot.

#### Scenario: The database is reachable

- **WHEN** the health endpoint is called and the database answers
- **THEN** the response is 200 and states that the database is reachable

#### Scenario: The database is unreachable

- **WHEN** the health endpoint is called and the database cannot be reached
- **THEN** the response is 503 with a machine-readable code, and the underlying driver error is logged rather than returned to the caller

### Requirement: Errors are returned in one envelope

Every endpoint SHALL report a failure as `{ error: { code, message, fieldErrors? } }` with a stable machine-readable `code`. A caught exception's own message MUST NOT be returned to the caller.

#### Scenario: A caller branches on a failure

- **WHEN** any endpoint fails
- **THEN** the response body carries a `code` that a client or a test can branch on without reading the message text

#### Scenario: An unexpected exception is raised

- **WHEN** a handler throws an error it does not recognise
- **THEN** the response carries a generic code and the original error is written to the log, not to the response
