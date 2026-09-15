/**
 * GET /api/health over real HTTP against the dev server started by `npm run e2e`
 * (start-server-and-test), running against a database that has just been reset and reseeded by
 * `npm run db:reset`. See .claude/rules/testing.md.
 */
describe('GET /api/health', () => {
  it('answers 200 and reports the database as reachable', () => {
    cy.request('/api/health').then((res) => {
      expect(res.status).to.eq(200);
      expect(res.body).to.deep.equal({ status: 'ok', database: 'reachable' });
    });
  });
});
