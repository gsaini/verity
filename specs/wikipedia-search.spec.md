---
name: Wikipedia search
baseUrl: https://en.wikipedia.org
tags: [smoke, pr]
---

## Description
Verify that searching for a topic on Wikipedia surfaces a relevant article and a usable table of contents.

## Steps
- Open the Wikipedia home page.
- Type "Anthropic" into the search box at the top of the page.
- Press Enter to submit the search.
- Wait for the article page to load.

## Expectations
- The article page heading should mention Anthropic.
- The page should contain a table of contents or section headings (e.g. History, Products).
- The URL should contain "/wiki/Anthropic".
