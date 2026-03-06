// ***********************************************************
// This support file is processed and loaded automatically
// before your test files.
//
// You can read more here:
// https://on.cypress.io/configuration
// ***********************************************************

// Import commands.ts using ES2015 syntax:
import './commands';

// Import cypress-mochawesome-reporter support
try {
  import('cypress-mochawesome-reporter/register');
} catch (e) {
  // Reporter not installed, skip
}

// Prevent Cypress from failing on uncaught exceptions from the app
Cypress.on('uncaught:exception', (err, runnable) => {
  // Return false to prevent Cypress from failing the test
  return false;
});
