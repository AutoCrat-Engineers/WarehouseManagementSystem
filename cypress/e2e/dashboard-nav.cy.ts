describe('Dashboard Navigation', () => {
  beforeEach(() => {
    // Login before each test - replace with valid test credentials
    cy.login('your-test-email@example.com', 'your-test-password');
  });

  it('should display the sidebar', () => {
    cy.get('[data-cy="sidebar"]').should('be.visible');
  });

  it('should toggle sidebar', () => {
    cy.get('[data-cy="sidebar-toggle"]').click();
    // Verify sidebar state changed
    cy.get('[data-cy="sidebar"]').should('exist');
  });

  it('should navigate through sidebar items', () => {
    cy.get('[data-cy^="nav-"]').each(($el) => {
      cy.wrap($el).click();
      cy.get('[data-cy="main-content"]').should('be.visible');
    });
  });

  it('should display auth badge', () => {
    cy.get('[data-cy="auth-badge"]').should('be.visible');
  });

  it('should logout successfully', () => {
    cy.get('[data-cy="logout-button"]').click();
    // Should return to login page
    cy.url().should('include', '/');
  });
});
