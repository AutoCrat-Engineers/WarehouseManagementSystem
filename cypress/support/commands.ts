/// <reference types="cypress" />

// Custom command declarations
declare namespace Cypress {
  interface Chainable {
    /**
     * Custom command to log in to the application
     * @param email - User email
     * @param password - User password
     */
    login(email: string, password: string): Chainable<void>;
  }
}

// Login command
Cypress.Commands.add('login', (email: string, password: string) => {
  cy.visit('/');
  cy.get('input[type="email"], input[name="email"]').clear().type(email);
  cy.get('input[type="password"], input[name="password"]').clear().type(password);
  cy.get('button[type="submit"]').click();
});
