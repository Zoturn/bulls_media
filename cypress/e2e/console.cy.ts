/**
 * The console's HTTP contract and its approval flow, over real HTTP against a freshly seeded
 * database (`npm run db:reset` before `npm run e2e`). Nothing here reaches a real model: the
 * paths that would need one are exercised in Jest against a mock model instead
 * (`src/lib/agent/startRun.spec.ts`), and every run this suite needs already decided is written
 * directly through Prisma by the `createFixtureRun` task — see cypress.config.ts.
 */
import { SEED } from '../../prisma/seed-data';

interface FixtureRunInput {
  caseId: string;
  status: 'RUNNING' | 'COMPLETED' | 'REFUSED' | 'NEEDS_HUMAN' | 'FAILED';
  assessment?: {
    disposition: string;
    summary: string;
    structured?: string;
    refusalReason?: string;
    quoteCents?: number;
    draftReply?: string;
  };
  approval?: { decision: 'APPROVED' | 'REJECTED'; decidedBy: string; note?: string };
}

// Every case this spec opens against a seeded message, so `after` can clean each one up: a case
// left behind blocks `seed-determinism.cy.ts`'s reseed from deleting the message it points at
// (that relation is `restrict`, not cascade, on purpose — see prisma/seed-lib.ts).
const openedCaseIds: string[] = [];

function openCase(inboundMessageId: string) {
  return cy.request('POST', '/api/cases', { inboundMessageId }).then((res) => {
    const caseId = res.body.caseId as string;
    openedCaseIds.push(caseId);
    return caseId;
  });
}

function fixtureRun(input: FixtureRunInput) {
  return cy.task<{ runId: string }>('createFixtureRun', input).then((r) => r.runId);
}

/**
 * Types into a controlled input and retries the whole keystroke, not just a value assertion, until
 * a resulting side effect confirms React actually saw it. This case-detail route is compiled on
 * demand by the Next dev server, so the very first visit to it in a run can serve HTML before the
 * client bundle has hydrated and attached React's event listeners — a keystroke landing in that
 * window sets the DOM's own `.value` (so a plain `.should('have.value', ...)` would pass) without
 * ever reaching the component's `onChange`, leaving its state — and anything gated on it, like the
 * Approve button below — unchanged. Retyping after a short wait resolves once hydration catches
 * up; a fast machine (or a route Cypress already visited) sees the effect on the first attempt and
 * never waits at all.
 */
function typeUntil(
  selector: string,
  value: string,
  isDone: () => Cypress.Chainable<boolean>,
  attemptsLeft = 6,
): void {
  cy.get(selector).clear().type(value);
  isDone().then((done) => {
    if (!done && attemptsLeft > 0) {
      cy.wait(250);
      typeUntil(selector, value, isDone, attemptsLeft - 1);
    }
  });
}

after(() => {
  openedCaseIds.forEach((caseId) => cy.task('deleteFixtureCase', caseId));
});

describe('GET /api/inbox', () => {
  it('lists a seeded message, unopened', () => {
    cy.request('/api/inbox').then((res) => {
      expect(res.status).to.eq(200);
      const entry = res.body.find(
        (e: { messageId: string }) => e.messageId === SEED.messages.missingBudget.id,
      );
      expect(entry).to.exist;
      expect(entry.case).to.be.null;
    });
  });
});

describe('POST /api/cases', () => {
  it('opens a case and is idempotent on a second call', () => {
    openCase(SEED.messages.ordinaryBrief.id).then((first) => {
      openCase(SEED.messages.ordinaryBrief.id).then((second) => {
        expect(second).to.eq(first);
      });
    });
  });

  it('404s for a message that does not exist', () => {
    cy.request({
      method: 'POST',
      url: '/api/cases',
      body: { inboundMessageId: 'msg-nope' },
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(404);
      expect(res.body.error.code).to.eq('NOT_FOUND');
    });
  });

  it('rejects a missing inboundMessageId with VALIDATION_ERROR', () => {
    cy.request({ method: 'POST', url: '/api/cases', body: {}, failOnStatusCode: false }).then(
      (res) => {
        expect(res.status).to.eq(400);
        expect(res.body.error.code).to.eq('VALIDATION_ERROR');
        expect(res.body.error.fieldErrors).to.have.property('inboundMessageId');
      },
    );
  });
});

describe('GET /api/cases/[caseId]', () => {
  it('404s for a case that does not exist', () => {
    cy.request({ url: '/api/cases/case-does-not-exist', failOnStatusCode: false }).then((res) => {
      expect(res.status).to.eq(404);
      expect(res.body.error.code).to.eq('NOT_FOUND');
    });
  });

  it('reports no run for a freshly opened case', () => {
    openCase(SEED.messages.notABrief.id).then((caseId) => {
      cy.request(`/api/cases/${caseId}`).then((res) => {
        expect(res.status).to.eq(200);
        expect(res.body.latestRun).to.be.null;
      });
    });
  });
});

describe('POST /api/cases/[caseId]/runs', () => {
  it('404s for a case that does not exist', () => {
    cy.request({
      method: 'POST',
      url: '/api/cases/case-does-not-exist/runs',
      failOnStatusCode: false,
    }).then((res) => {
      expect(res.status).to.eq(404);
      expect(res.body.error.code).to.eq('NOT_FOUND');
    });
  });

  it('409s against a case that already has a RUNNING run', () => {
    openCase(SEED.messages.prohibitedVertical.id).then((caseId) => {
      fixtureRun({ caseId, status: 'RUNNING' }).then(() => {
        cy.request({
          method: 'POST',
          url: `/api/cases/${caseId}/runs`,
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(409);
          expect(res.body.error.code).to.eq('RUN_IN_PROGRESS');
        });
      });
    });
  });
});

describe('POST /api/runs/[runId]/approval', () => {
  it('rejects a malformed body with VALIDATION_ERROR and field errors', () => {
    openCase(SEED.messages.reviewVertical.id).then((caseId) => {
      fixtureRun({
        caseId,
        status: 'COMPLETED',
        assessment: {
          disposition: 'QUOTED',
          summary: 'Priced.',
          quoteCents: 100,
          draftReply: 'Hi.',
        },
      }).then((runId) => {
        cy.request({
          method: 'POST',
          url: `/api/runs/${runId}/approval`,
          body: { decision: 'MAYBE' },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(400);
          expect(res.body.error.code).to.eq('VALIDATION_ERROR');
          expect(res.body.error.fieldErrors).to.have.keys(['decision', 'decidedBy']);
        });
      });
    });
  });

  it('succeeds against a completed run and resolves its case', () => {
    openCase(SEED.messages.ordinaryBrief.id).then((caseId) => {
      fixtureRun({
        caseId,
        status: 'COMPLETED',
        assessment: {
          disposition: 'QUOTED',
          summary: 'Priced the spring campaign.',
          quoteCents: 760_000,
          draftReply: 'Hi Priya — here are the packages we can offer.',
        },
      }).then((runId) => {
        cy.request('POST', `/api/runs/${runId}/approval`, {
          decision: 'APPROVED',
          decidedBy: 'Jordan',
        }).then((res) => {
          expect(res.status).to.eq(200);
          expect(res.body.approvalId).to.be.a('string');
        });

        cy.request(`/api/cases/${caseId}`).then((res) => {
          expect(res.body.status).to.eq('RESOLVED');
          expect(res.body.latestRun.approval.decision).to.eq('APPROVED');
          expect(res.body.latestRun.approval.decidedBy).to.eq('Jordan');
        });
      });
    });
  });

  it('rejects a second decision on the same run', () => {
    openCase(SEED.messages.missingBudget.id).then((caseId) => {
      fixtureRun({
        caseId,
        status: 'COMPLETED',
        assessment: {
          disposition: 'NEEDS_INFO',
          summary: 'Missing budget.',
          draftReply: 'Could you share a budget?',
        },
      }).then((runId) => {
        cy.request('POST', `/api/runs/${runId}/approval`, {
          decision: 'APPROVED',
          decidedBy: 'First',
        });

        cy.request({
          method: 'POST',
          url: `/api/runs/${runId}/approval`,
          body: { decision: 'REJECTED', decidedBy: 'Second' },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(409);
          expect(res.body.error.code).to.eq('ALREADY_DECIDED');
        });
      });
    });
  });

  it('rejects a run with no saved assessment', () => {
    openCase(SEED.messages.injectionAttempt.id).then((caseId) => {
      fixtureRun({ caseId, status: 'RUNNING' }).then((runId) => {
        cy.request({
          method: 'POST',
          url: `/api/runs/${runId}/approval`,
          body: { decision: 'APPROVED', decidedBy: 'Jordan' },
          failOnStatusCode: false,
        }).then((res) => {
          expect(res.status).to.eq(409);
          expect(res.body.error.code).to.eq('NO_ASSESSMENT');
        });
      });
    });
  });
});

describe('the console UI', () => {
  it('lists the inbox and opens a case from it', () => {
    cy.visit('/console');
    cy.contains(SEED.messages.notABrief.subject).should('be.visible');
  });

  it('shows a completed run, its draft reply, and lets an operator approve it', () => {
    openCase(SEED.messages.injectionClaimedException.id).then((caseId) => {
      fixtureRun({
        caseId,
        status: 'COMPLETED',
        assessment: {
          disposition: 'QUOTED',
          summary: 'Priced the spring campaign for North Road Autos.',
          quoteCents: 760_000,
          draftReply: 'Hi Priya — here are the packages we can offer.',
        },
      }).then(() => {
        cy.visit(`/console/cases/${caseId}`);

        cy.contains('Priced the spring campaign').should('be.visible');
        cy.contains('here are the packages we can offer').should('be.visible');

        typeUntil('input[placeholder="Who is deciding?"]', 'Jordan', () =>
          cy.contains('button', 'Approve').then(($btn) => cy.wrap(!$btn.is(':disabled'))),
        );
        cy.contains('button', 'Approve').should('not.be.disabled').click();

        cy.contains('Approved by Jordan').should('be.visible');
      });
    });
  });

  it('shows why a case was refused', () => {
    openCase(SEED.messages.injectionInSenderName.id).then((caseId) => {
      fixtureRun({
        caseId,
        status: 'REFUSED',
        assessment: {
          disposition: 'REFUSED',
          summary: 'Gambling is not accepted.',
          refusalReason: 'Gambling is not accepted on this network.',
        },
      }).then(() => {
        cy.visit(`/console/cases/${caseId}`);
        cy.contains('Refused').should('be.visible');
        cy.contains('Gambling is not accepted on this network.').should('be.visible');
      });
    });
  });
});
