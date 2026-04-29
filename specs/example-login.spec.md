---
name: Example login flow
baseUrl: https://the-internet.herokuapp.com
tags: [auth, pr]
---

## Description
Verify the standard login flow on the public test site "the-internet.herokuapp.com" works end-to-end with valid credentials.

## Steps
- Navigate to /login on the base URL.
- Type "tomsmith" into the Username field.
- Type "SuperSecretPassword!" into the Password field.
- Click the "Login" button.
- Wait for the page to confirm the login was successful.

## Expectations
- After logging in, the page should display a success message confirming the login.
- The URL should change to /secure.
- A "Logout" button should be visible on the page.
