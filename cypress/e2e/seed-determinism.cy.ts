/**
 * Verifies the "seed is deterministic" requirement over real reseeding, via the `reseed` task
 * defined in cypress.config.ts. No HTTP endpoint exposes the seeded rows yet in this change, so
 * the task talks to Prisma directly rather than this spec making an HTTP request — see
 * .claude/rules/testing.md on why this still belongs in Cypress: it is the runner responsible for
 * end-to-end database state, even before every read has an API in front of it.
 */
import { INJECTION_CORPUS_KEYS, SEED } from '../../prisma/seed-data';

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

  it('produces exactly the fixture ids the seed declares', () => {
    // Derived from SEED rather than a second hand-written list: this spec exists to prove that
    // reseeding puts the declared fixtures in the database, not to restate them. A hard-coded
    // list turns every addition to the corpus into an unrelated Cypress failure, which is how a
    // determinism test starts getting edited to match reality instead of checking it.
    const expected = Object.values(SEED.messages)
      .map((message) => message.id)
      .sort();

    cy.task<ReseedSnapshot>('reseed').then((snapshot) => {
      expect(snapshot.messages.map((m) => m.id).sort()).to.deep.equal(expected);
    });
  });

  it('seeds the whole injection corpus, not merely some of it', () => {
    const corpusIds = INJECTION_CORPUS_KEYS.map((key) => SEED.messages[key].id);

    cy.task<ReseedSnapshot>('reseed').then((snapshot) => {
      const seeded = snapshot.messages.map((m) => m.id);
      for (const id of corpusIds) {
        expect(seeded).to.include(id);
      }
    });
  });
});
