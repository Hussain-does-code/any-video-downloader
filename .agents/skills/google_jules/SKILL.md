---
name: google_jules
description: Use Google Jules API to autonomously delegate background coding tasks, generate unit test suites, refactor codebases on isolated Google Cloud VMs, and create GitHub Pull Requests asynchronously.
---

# 🤖 Google Jules Autonomous Coding Skill

This skill allows Antigravity to interact with Google Jules (`jules.googleapis.com`) to dispatch asynchronous coding jobs, generate pull requests, and delegate background refactoring to Google Cloud VMs.

## Prerequisites
The API key is securely configured in `C:\Users\Hussain\.gemini\config\skills\google_jules\.env`.

## How to Delegate Tasks to Google Jules
1. Run the client utility script:
   `node "C:\Users\Hussain\.gemini\config\skills\google_jules\jules_client.js" status`
2. Delegate large, asynchronous tasks (e.g. comprehensive test suite generation, dependency migrations, long-running refactoring) to Jules so they execute in Google Cloud VMs while we continue local pair programming in parallel.
3. When Jules finishes a cloud task and opens a GitHub Pull Request, use Antigravity to review and audit the PR before merging.
