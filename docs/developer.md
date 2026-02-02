# 💻 Developer Guide

Welcome to the WMS Development team. This guide outlines the workflow and standards for developing on this repository.

## 🛠️ Local Development Setup

Follow these steps to get your environment ready:

1.  **Clone & Install**:
    ```bash
    git clone https://github.com/AutoCrat-Engineers/Warehouse-Management-System.git
    npm install
    ```

2.  **Environment Variables**:
    Copy `.env.example` (if provided) to `.env` or create one with:
    ```env
    VITE_SUPABASE_URL=your_url
    VITE_SUPABASE_ANON_KEY=your_key
    ```

3.  **Start Development Server**:
    ```bash
    npm run dev
    ```

## 🔍 Debugging Guidelines

- **Browser DevTools**: Use the React DevTools extension to inspect component state and props.
- **Network Tab**: Monitor XHR/Fetch requests to ensure correct API communication with Supabase.
- **Supabase Logs**: Access the Supabase Dashboard for database query logs and Edge Function execution logs.

## 🧪 Testing

We aim for high test coverage on critical business logic.

- **Running Tests**: `npm test` (Uses Vitest/Jest)
- **Component Testing**: Use React Testing Library for UI components.
- **Integration Testing**: Test the interaction between hooks and services.

## 🚀 CI/CD Pipeline

Our CI/CD pipeline (GitHub Actions) performs the following on every Pull Request:
1.  **Linting**: Ensures code adheres to ESLint/Prettier standards.
2.  **Type Checking**: Runs `tsc` to verify TypeScript integrity.
3.  **Security Scan**: Checks for vulnerable dependencies.
4.  **Automated Build**: Verifies the project builds successfully.

## 📜 Coding Standards

- **Functional Components**: Use React Functional Components and Hooks.
- **Naming Conventions**: 
    - Components: `PascalCase`
    - Hooks: `useCamelCase`
    - Utilities: `camelCase`
    - Types: `PascalCase` (e.g., `Item`, `InventoryResponse`)
- **Structure**: Keep components small and focused. Extract logic into hooks when it grows beyond 50 lines.

## 📦 Dependency Management

- Use `npm install` for adding new packages.
- Always check for bundle size impact before adding large libraries.
- Prefer Radix UI or established headless libraries for complex UI components.

---

**Happy Coding!**  
For any questions, reach out on the #engineering Slack channel.
