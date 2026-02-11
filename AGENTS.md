# AGENTS.md

This file provides guidance for Factory AI agents working on this codebase.

## Agent Guidelines

### Before Starting Work

1. **Check GitHub Issues**: Run gh issue list --repo michaelhmiv/Sportfolio-Replit to review open issues before making changes. Reference issue numbers in commits and code comments.

2. **Read CLAUDE.md**: Review CLAUDE.md for project-specific patterns and workflows.

3. **Plan Mode**: Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions). Write detailed specs upfront to reduce ambiguity.

### Key Project Patterns

- **API Migration**: MySportsFeeds → BallDontLie (NBA)
- **Database**: PostgreSQL with Drizzle ORM
- **Frontend**: React with TanStack Query, Wouter router
- **Real-time**: WebSocket for live updates
- **Testing**: Vitest for unit tests

### Workflow Orchestration

#### 1. Plan Mode Default

- Enter plan mode for non-trivial tasks
- If something goes sideways, STOP and re-plan immediately
- Use plan mode for verification steps
- Write detailed specs upfront

#### 2. Subagent Strategy

- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

#### 3. Self-Improvement Loop

- After ANY correction from the user: update asks/lessons.md
- Write rules to prevent the same mistake
- Review lessons at session start

#### 4. Verification Before Done

- Never mark task complete without proving it works
- Diff behavior between main and changes when relevant
- Ask: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

#### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: implement the elegant solution
- Skip this for simple, obvious fixes
- Challenge your own work before presenting it

#### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests → then resolve them
- Zero context switching required from user

### Task Management

1. **Plan First**: Write plan to asks/todo.md with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review to asks/todo.md
6. **Capture Lessons**: Update asks/lessons.md after corrections

### Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.

### Important Files

- CLAUDE.md - Project-specific coding guidelines
-     asks/todo.md - Current task tracker
-     asks/lessons.md - Lessons learned from corrections
- README.md - Project setup and documentation

### Git Workflow

Before ANY commit or push:

- Run git diff --cached to review changes
- Run git status to confirm files being included
- Check for secrets, credentials, API keys in changes
- Stop and warn if sensitive data detected

### Testing

- Always run
  pm run check before completing tasks
- Run
  pm run test when applicable
- Fix all diagnostics and errors in system reminder messages

### Environment

- Check tool availability before using (rg, gh, ffmpeg, python3, etc.)
- Use absolute paths with file tools (Read, Edit, Create)
- Never call file editing tools for the same file in parallel

## Custom Agents

The following custom droids are available and should be used when relevant:

- **code-quality-reviewer** - Reviews code quality and maintainability
- **documentation-accuracy-reviewer** - Verifies documentation accuracy
- **git-summarizer** - Collects detailed repository context
- **performance-reviewer** - Identifies performance bottlenecks
- **pr-readiness-reviewer** - Assesses branch readiness for PRs
- **release-notes-writer** - Analyzes commit history for release notes
- **security-code-reviewer** - Reviews diffs for security issues
- **test-coverage-reviewer** - Reviews testing implementation and coverage
- **test-plan-writer** - Produces focused test plans for changes
- **todo-fixme-scanner** - Scans for TODO and FIXME markers

## Common Tasks

### Adding a New Feature

1. Research existing patterns in codebase
2. Check for related open issues
3. Write implementation plan to asks/todo.md
4. Implement with minimal impact
5. Add/update tests
6. Verify with
   pm run check and
   pm run test
7. Document any breaking changes

### Fixing a Bug

1. Reproduce the issue if possible
2. Identify root cause
3. Write fix
4. Add tests to prevent regression
5. Verify all tests pass
6. Commit with reference to issue number

### Database Changes

1. Create Drizzle migration
2. Review with
   pm run db:push
3. Update shared schema
4. Test changes locally
5. Document any breaking changes
