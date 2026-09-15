/**
 * Verifies the "seed is deterministic" requirement over real reseeding, via the `reseed` task
 * defined in cypress.config.ts. No HTTP endpoint exposes the seeded rows yet in this change, so
 * the task talks to Prisma directly rather than this spec making an HTTP request — see
 * .claude/rules/testing.md on why this still belongs in Cypress: it is the runner responsible for
 * end-to-end database state, even before every read has an API in front of it.
 */
interface ReseedSnapshot {
  messages: Array<{ id: string }>;
  rates: Array<{ id: string }>;
  policies: Array<{ id: string }>;
}

describe('seeding twice', () => {
  it('leaves every fixture id and value unchanged', () => {
    cy.task<ReseedSnapshot>('reseed').then((first) => {
      cy.task<ReseedSnapshot>('reseed').then((second) => {
        expect(second).to.deep.equal(first);
      });
    });
  });

  it('produces the documented fixture ids', () => {
    cy.task<ReseedSnapshot>('reseed').then((snapshot) => {
      const ids = snapshot.messages.map((m) => m.id).sort();

      expect(ids).to.deep.equal(
        [
          'msg-injection-attempt',
          'msg-missing-budget',
          'msg-not-a-brief',
          'msg-ordinary-brief',
          'msg-prohibited-vertical',
          'msg-review-vertical',
        ].sort(),
      );
    });
  });
});
