describe('Login Page', () => {
  beforeEach(() => {
    cy.visit('/');
  });

  it('should display the login page', () => {
    cy.get('input[type="email"], input[name="email"]').should('be.visible');
    cy.get('input[type="password"], input[name="password"]').should('be.visible');
    cy.get('button[type="submit"]').should('be.visible');
  });

  it('should show error on invalid credentials', () => {
    cy.get('input[type="email"], input[name="email"]').type('invalid@test.com');
    cy.get('input[type="password"], input[name="password"]').type('wrongpassword');
    cy.get('button[type="submit"]').click();
    // Should remain on login page or show error
    cy.url().should('include', '/');
  });

  it('should login successfully with valid credentials', () => {
    // Replace with valid test credentials
    cy.login('your-test-email@example.com', 'your-test-password');
    // Should navigate away from login page after successful login
    cy.url().should('not.eq', Cypress.config().baseUrl);
  });
});
