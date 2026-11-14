---
theme: none
title: Make AI Write Better Code
info: Josh Goldberg's talk at React Summit US 2026 on guardrailing AI coding agents with skills, static analysis, tests, and review.
author: Josh Goldberg
colorSchema: dark
transition: fade
highlighter: shiki
lineNumbers: false
twoslash: true
contextMenu: dev
download: false
drawings:
  persist: false
  presenterOnly: true
fonts:
  sans: League Spartan Variable
  mono: ui-monospace
  provider: none
layout: cover
---

# Make AI Write Better Code

<div class="cover-footer">
  <img alt="QR code linking to hi.joshuakgoldberg.com" src="/images/qr-hi-joshuakgoldberg.png" />
  <div>
    <div class="cover-name">Josh Goldberg</div>
    <div class="cover-handle">@ JoshuaKGoldberg .com</div>
  </div>
  <img alt="QR code linking to hi.joshuakgoldberg.com" src="/images/qr-hi-joshuakgoldberg.png" />
</div>

<style>
.cover-footer {
  align-items: end;
  bottom: 2.5rem;
  display: flex;
  justify-content: space-between;
  left: 4rem;
  position: absolute;
  right: 4rem;
}

.cover-footer img {
  width: 8.5rem;
}

.cover-name {
  color: var(--jg-fg-strong);
  font-size: var(--jg-size-large);
  font-weight: var(--jg-weight-bold);
}

.cover-handle {
  color: var(--jg-link);
  font-size: var(--jg-size-medium);
  font-weight: var(--jg-weight-medium);
  margin-top: 0.75rem;
}
</style>

<!--
Hi everyone, last talk of the day! We feeling good?

Thanks to Ken for that talk. He's right: you can build anything now. This talk is about how to build it *well*.
-->

---
layout: default
---

<div class="intro">
  <div>
    <h1>👋</h1>
    <h2>Frontend @ Sentry</h2>
    <ul class="projects">
      <li><img alt="" src="/images/bingo.png" />Bingo</li>
      <li><img alt="" src="/images/create-typescript-app.png" />create-typescript-app</li>
      <li><img alt="" src="/images/emoji-blast.png" />emoji-blast</li>
      <li><img alt="" src="/images/typescript-eslint.png" />typescript-eslint</li>
      <li><img alt="" src="/images/octoguide.png" />OctoGuide</li>
    </ul>
  </div>
  <div class="intro-images">
    <img alt="Josh Goldberg" class="intro-photo" src="/images/josh.png" />
    <img alt="Learning TypeScript book cover" class="intro-book" src="/images/learning-typescript.png" v-click />
    <img alt="SquiggleConf, the devtools conference: May 7th, 2027 in Boston, Massachusetts" class="intro-squiggleconf" src="/images/squiggleconf.jpg" v-click />
  </div>
</div>

<style>
.intro {
  display: grid;
  gap: 2rem;
  grid-template-columns: 1fr 1fr;
  height: 100%;
}

.intro h1 {
  font-size: var(--jg-size-title);
}

.intro h2 {
  margin: 0.75rem 0 1.5rem;
}

.projects {
  gap: 0.6rem;
  list-style: none;
  padding: 0;
}

.projects li {
  align-items: center;
  display: flex;
  font-weight: var(--jg-weight-medium);
  gap: 1rem;
}

.projects img {
  height: 2rem;
  object-fit: contain;
  width: 2rem;
}

.intro-images {
  display: grid;
  gap: 1.25rem;
  grid-template-areas: "book photo" "squiggle squiggle";
  grid-template-columns: 1fr 1fr;
  place-items: center;
}

.intro-photo {
  border-radius: 100%;
  box-shadow: 0 0 2rem var(--jg-subtle);
  grid-area: photo;
  width: 11rem;
}

.intro-book {
  grid-area: book;
  width: 9rem;
}

.intro-squiggleconf {
  grid-area: squiggle;
  width: 26.5rem;
}

.intro-images .slidev-vclick-target {
  transition: none;
}
</style>

<!--
I'm a senior frontend developer at Sentry, which provides best-in-class application monitoring software. I'm also an open source maintainer on dev tooling around JavaScript and TypeScript.

Who here uses typescript-eslint? ESLint? Who here has sworn at either of them?

[click] I'm also the author of the O'Reilly Learning TypeScript book

[click] and a co-organizer of SquiggleConf, a conference for excellent web dev tooling. I love dev tooling.

https://learningtypescript.com
-->

---
layout: full
---

<GitHubSquares />

<!--
I've been in open source for over a decade now. For four of those years I was focused on dev tooling: typescript-eslint, create-typescript-app, and friends. Tools to make development better.

In my time working on corporate products, then on dev tooling in open source, then on corporate products again, I've come to really respect one idea above most others...
-->

---
layout: center
---

## "The Bug Acquisition Funnel"

<BugFunnel bottom="Some (never none)" top="Many bugs" />

<p class="muted funnel-caption">(not to scale)</p>

<!--
I first drew this when I was convincing a team to adopt TypeScript, back in 2019.

Think of all the possible strategies you can take to reduce bugs in your end product as parts of a long process that starts from your application existing in the first place, stretches through the development process, and ends with it in your users' hands. In product terms, we'd call this an acquisition funnel. I like to call it the "bug acquisition funnel".

Each stage catches some of the bugs the stages before it missed. And it's not drawn to scale.

A coworker put it nicely: nobody sets out to write a bug. Bugs are just out there, waiting to slip through. Every decision you make, and every check you automate, filters more of them out before they reach users.

It is incredibly rare for a software application to completely catch and fix all its bugs, so this funnel assumes some are left over even with all the steps.
-->

---
layout: center
clicks: 5
---

<BugFunnel development />

<p class="order-caption" v-click="5">The earlier a stage catches a bug, the cheaper it usually is to fix.</p>

<style>
.order-caption {
  font-size: var(--jg-size-medium);
  margin-top: 0.5rem;
}
</style>

<!--
Today we're going to talk about the four parts of the funnel that happen while code is being written. These are the same four parts whether a human or an agent is writing it.

[click] Design thought: what should it be? That's where the spec comes from.

[click] Static analysis: is it written right?

[click] Dynamic analysis: does it match the spec?

[click] Peer review: is the spec correct?

[click] Why this order? It's the order they happen in as you write code, and the earlier a stage catches a bug, the cheaper it usually is to fix. Design thought catches a bad idea while it's still a plan. Static analysis catches mistakes seconds after a change. Tests take minutes. Review takes hours or days. And anything that gets past all four, your users find for you.

That's doubly true with agents: the earlier a check runs, the sooner the agent can fix its own mistake, before you ever see it.

Are we ready?
-->

---
layout: center
---

<img alt="SpongeBob excitedly saying: I'm ready!" class="spongebob" src="/images/spongebob.gif" />

<style>
.spongebob {
  width: 30rem;
}
</style>

<!--
I'm ready!

“I’m Ready”: https://giphy.com/gifs/spongebob-season-4-spongebob-squarepants-l1Aswx03WbLDf9kYw
-->

---
layout: center
---

<BugFunnel current="Design Thought" />

<!--
Part one of four: design thought. What should it be?
-->

---
layout: section
---

<div class="eyebrow">1/4 Design Thought</div>

# Knowing Your S#!7

<p class="muted">Decide what it should be before anything writes it</p>

<div class="eyebrow">1/2</div>

<!--
Step one is knowing what you're doing.
-->

---
layout: statement
---

# There is no substitute for human discretion.

<p v-click>If you don't design it, a guesswork machine will.</p>

<!--
There is no substitute for human discretion.

[click] If you don't design it, a guesswork machine will. And its guesses lean toward whatever was most common in its training data, not what's right for your app.
-->

---
layout: default
---

## An Incomplete List of Recent Best-In-Class Model Outputs

<ul>
  <li v-click>Class components (like it's 2016)</li>
  <li v-click>O(N<sup>3</sup>) loops on hot paths</li>
  <li v-click>Copies of the design system</li>
  <li v-click>Blatant accessibility issues</li>
  <li v-click>Sexual innuendo</li>
  <li v-click>Six near-identical copies of a large component</li>
  <li v-click>More emdashes, load-bearing phrases, and honest truths than you could possibly imagine</li>
</ul>

<!--
Don't believe me? Here's an incomplete list of things I've gotten from best-in-class models recently.

[click] Class components, like it's 2016. There's a lot of old React in the training data.

[click] O(N cubed) loops on hot paths.

[click] Copies of the design system, instead of using the design system.

[click] Blatant accessibility issues.

[click] Sexual innuendo. I won't show that one.

[click] Six near-identical copies of a large component.

[click] And more emdashes, load-bearing phrases, and honest truths than you could possibly imagine.

Every one of these compiled. Most of them would have passed a quick skim.
-->

---
layout: center
---

<img alt="RuPaul in drag angrily asking: what the hell?" class="reaction" src="/images/rupaul-what-the-hell.gif" />

<!--
What the hell.

“Ru Paul What The Hell”: https://giphy.com/gifs/paramountplus-rupaul-paramount-plus-pcoa9GfYAkJvS7exrl
-->

---
layout: default
---

## Precise Prompting

<div class="cards principles">
  <div v-click>
    <h3>Know the task ahead of time</h3>
    <p>Have it write a plan first. Read the plan before any code exists.</p>
  </div>
  <div v-click>
    <h3>Context up appropriately</h3>
    <p>Name the files, docs, and existing patterns to follow.</p>
  </div>
  <div v-click>
    <h3>Review everything</h3>
    <p>Once you merge it, every line is yours.</p>
  </div>
</div>

<!--
[click] Know the task ahead of time. If you can't describe what done looks like, the model can't either. I have it write a plan first, and I read the plan before any code exists. That plan is the spec.

[click] Context up appropriately. Point it at the files, the docs, and the existing code it should follow.

[click] Review everything. Once you merge it, it's your code.
-->

---
layout: default
---

## Example: Vague vs. Precise

<div class="prompts">
<div>

<p class="muted">Vague</p>

```md
Add favorites to the talk list.
```

</div>
<div v-click>

<p class="muted">Precise</p>

```md
Add a favorite toggle to each TalkCard.
- Persist favorites with the existing useStoredState
  hook in src/hooks/useStoredState.ts.
- Use the design system's ToggleButton.
- Add tests to TalkCard.test.tsx for toggling and
  for favorites surviving a reload.
- Don't change any other components.
```

</div>
</div>

<style>
.prompts {
  display: grid;
  gap: 2rem;
  grid-template-columns: 1fr 1.6fr;
}
</style>

<!--
Here's what that looks like.

A vague prompt leaves every decision to the model: where state lives, which components to use, whether there are tests.

[click] A precise prompt makes those decisions up front. It names the existing hook and the design system component, so you don't get a seventh copy of either. It says what the tests should cover. And it scopes the change.

That's most of a spec, in six lines. When it comes to LLMs, you get out what you put in.
-->

---
layout: default
---

## Protip: Keep Coding by Hand

<p class="big" v-click>At least once a week, take on a real code task <strong>without AI</strong>.</p>

<div class="cards reasons" v-click>
  <div>
    <h3>Context</h3>
    <p>You stay current on how your codebase actually works.</p>
  </div>
  <div>
    <h3>Judgment</h3>
    <p>You can only review well what you can still write.</p>
  </div>
</div>

<style>
.reasons {
  display: grid;
  gap: 2.5rem;
  grid-template-columns: 1fr 1fr;
  margin-top: 2.5rem;
}

.reasons h3 {
  color: var(--jg-squiggle);
  margin-bottom: 0.25rem;
}
</style>

<!--
None of that works if you've stopped knowing your codebase.

[click] So at least once a week, take on a real code task without AI. Not a toy. A real ticket.

[click] Two reasons. Context: you stay current on how the code actually works, which is what lets you write those precise prompts. And judgment: you can only review well what you can still write yourself.

Sometimes it's also just faster to do the task yourself.
-->

---
layout: section
---

<div class="eyebrow">1/4 Design Thought</div>

# Skills

<p class="muted">Is this another buzzword we have to memorize now?</p>

<div class="eyebrow">2/2</div>

<!--
The other half of design thought is skills: teaching your agent how to do the common tasks specific to your stack and repository.
-->

---
layout: default
---

## What's a Skill?

<p>A skill is a set of instructions an agent loads when a task calls for it.</p>

<div class="skill-anatomy">

```md
---
name: pr-screenshots
description: Capture screenshots of the UI ...
---

# PR Screenshots

## Step 1: List the Locations
...
```

<div>
  <p v-click><strong>Name and description:</strong> always in context, so the agent knows the skill exists</p>
  <p v-click><strong>Body:</strong> loaded only when the task calls for it</p>
  <p v-click><strong>Extra files:</strong> scripts and references, read on demand</p>
</div>

</div>

<p class="source">An open format: agentskills.io</p>

<style>
.skill-anatomy {
  align-items: center;
  display: grid;
  gap: 2rem;
  grid-template-columns: 1.2fr 1fr;
}

.skill-anatomy p {
  font-size: var(--jg-size-medium);
  margin-bottom: 1rem;
}
</style>

<!--
A skill is a folder with a SKILL.md file in it.

[click] The name and description are always in the agent's context, so it knows the skill exists.

[click] The body only gets loaded when a task calls for it. So you can have lots of skills without filling up the context window.

[click] And a skill can bundle extra files, like scripts and reference docs, that are only read when needed.

It's an open format now, so the same skill works across most agents.

Links:

- https://agentskills.io/specification
-->

---
layout: default
---

## Where Should Context Go?

<div class="cards context-grid">
  <div v-click>
    <h3><code>AGENTS.md</code></h3>
    <p class="muted">Always true</p>
    <p>Your stack, commands, and conventions</p>
  </div>
  <div v-click>
    <h3>Skills</h3>
    <p class="muted">Sometimes needed</p>
    <p>How to do a specific task</p>
  </div>
  <div v-click>
    <h3>CI checks</h3>
    <p class="muted">Always enforced</p>
    <p>Linting, type checking, tests, and more</p>
  </div>
</div>


<style>
.context-grid {
  display: grid;
  gap: 2.5rem;
  grid-template-columns: repeat(3, 1fr);
  margin: 2rem 0;
}

.context-grid h3 code {
  padding-inline: 0;
}
</style>

<!--
So where does context go?

[click] AGENTS.md is for things that are always true about your project: the stack, the commands, the conventions. It's always loaded.

[click] Skills are for things that are sometimes needed: how to do a specific task.

[click] And anything that has to happen every time goes in CI checks: linting, type checking, tests, and more. The agent can ignore an instruction. It can't ignore a failing build.

Facts go in AGENTS.md. Procedures go in skills. Rules go in CI.

Links:

- https://agents.md
-->

---
layout: default
---

## Example: A Skill for Adversarial Review

```md
---
name: adversarial-review
description: Adversarially reviews the current changes, fixes the findings,
  and repeats until a review comes back clean.
---

1. Review the diff as a skeptical reviewer: correctness, edge cases,
   accessibility, performance, and simplicity.
2. List each finding with its file, line, and severity. Don't fix yet.
3. Fix every real finding. Re-run lint, type checking, and tests.
4. Repeat from step 1 until a review finds nothing new.
```


<!--
This is the one I use the most.

Ask for an adversarial review of the changes, fix what it finds, and repeat until a review comes back clean.

The "repeat" part matters. One round isn't enough, because fixes cause new bugs. Keep going until a review comes back clean.

Fair warning: it burns through tokens like nothing else. The results are usually worth it.
-->

---
layout: default
---

## Example: A Skill for Browser QA

```md
---
name: pr-screenshots
when_to_use: When a pull request intentionally modifies the frontend
  such that users would see a difference.
---

Screenshots in a PR are QA evidence.

- List every place in the product that the diff reaches.
- Real build only: never screenshot a story, mock page, or harness
  built for the PR.
- No injected changes: never inject CSS or change the DOM to imitate
  the change.
- Identical framing: capture the same region at the same dimensions
  for both shots of a pair.
```

<p class="source">github.com/getsentry/skills: pr-screenshots</p>

<!--
For frontend changes, here's one for browser QA, from Sentry's shared skills repo.

Screenshots in a PR are QA evidence. So the rules are about keeping them honest. Find every place the change shows up. Screenshot the real build, never a mock page. Never inject CSS to fake the change. And frame before and after identically, so they can be compared.

Links:

- https://github.com/getsentry/skills/tree/main/skills/pr-screenshots
-->

---
layout: default
---

## Example: A Skill for PR Screenshots

```md
- Lay screenshots out in before/after tables, one row per location and state.
- Pixel-diff every before/after pair. Move pairs with no visible
  difference to **Unchanged**.
- Upload with `gh --attach`. Do not push asset branches or commit images.
- Before writing a body the user may have edited, fetch it again.
```

```shell
gh pr edit 123 --body-file pr-body.md \
  --attach './shots/logs-before.png' --attach './shots/logs-after.png'
```

<p class="source">github.com/getsentry/skills: pr-screenshots</p>

<!--
The same skill also puts those screenshots in the pull request description.

Before/after tables, one row per location and state. Pixel-diff every pair, so "no visible change" is checked, not assumed.

And upload them with the GitHub CLI's --attach flag. I wrote this skill recently, because before it, agents would push images to a branch or try to drag them into the browser.

Plus my favorite rule: before rewriting a PR description, fetch it again, in case a human edited it.

I put screenshots in the description of every frontend PR, and writing that description doubles as my own QA pass.

Links:

- https://github.com/getsentry/skills/tree/main/skills/pr-screenshots
- https://cli.github.com/manual/gh_pr_edit
-->

---
layout: default
---

## Where to Find Skills

<div class="cards skill-sources">
  <div v-click>
    <h3>Your team's</h3>
    <p>Sentry shares ours, like <code>pr-screenshots</code>.</p>
    <p class="muted">github.com/getsentry/skills</p>
  </div>
  <div v-click>
    <h3>Other people's</h3>
    <p>Anthropic's examples are a good place to start.</p>
    <p class="muted">github.com/anthropics/skills</p>
  </div>
  <div v-click>
    <h3>Your own</h3>
    <p>Like <code>adversarial-review</code>, or distilled from your past work.</p>
    <p class="muted">More on that in part four</p>
  </div>
</div>

<p class="big" v-click>Read a skill before you install it. Your agent may follow anything in it.</p>

<style>
.skill-sources {
  display: grid;
  gap: 1.5rem;
  grid-template-columns: repeat(3, 1fr);
  margin-bottom: 1.5rem;
}

.skill-sources h3 {
  color: var(--jg-squiggle);
  margin-bottom: 0.5rem;
}

.skill-sources p {
  font-size: var(--jg-size-small);
  margin: 0 0 0.4rem;
}

.skill-sources code {
  white-space: nowrap;
}
</style>

<!--
You might be wondering: which skills do I actually use, and where do they come from?

[click] Your team's. Sentry keeps a shared skills repo, with skills like pr-screenshots, which we just saw, find-bugs, and iterate-pr.

[click] Other people's. Anthropic's skills repo is a good set of examples to learn from and adapt.

[click] And your own. That adversarial-review skill from a few slides back is about a dozen lines: copy it. We'll talk about distilling your own past work into skills in part four.

[click] One warning: read a skill before you install it. Your agent may follow any instruction in it, and run any script it bundles. Treat it like any other dependency. Sentry even has a skill-scanner skill for checking skills for prompt injection and other risks.

All of these are linked at the end.

Links:

- https://github.com/getsentry/skills
- https://github.com/anthropics/skills
- https://agentskills.io
-->

---
layout: default
---

<div class="eyebrow">1/4 Design Thought</div>

## Recap: What Should It Be?

<div class="recap">
  <span class="muted">You</span>
  <span class="muted">So your agent…</span>
  <strong>Prompt precisely</strong>
  <span>builds what you meant, not the most common guess</span>
  <strong>Keep coding by hand</strong>
  <span>gets reviewed by someone who knows the code</span>
  <strong>Procedures in skills</strong>
  <span>follows your playbook for recurring tasks</span>
</div>

<!--
Quick recap of part one. On the left, what you do. On the right, how that makes your agent write better code.

(Pause a beat for people to read, then move on.)
-->

---
layout: center
---

<BugFunnel current="Static Analysis" />

<!--
Part two of four: static analysis. Is it written right?
-->

---
layout: default
---

## Static Analysis

<p class="big">Tooling that scrutinizes code without running it.</p>

<p class="muted">(in contrast with "dynamic analysis": e.g. testing)</p>

<p v-click>Seconds to run. Same answer every time. Feedback inside the agent's loop.</p>

<!--
Static analysis is tooling that scrutinizes code without running it. That's in contrast with dynamic analysis, like testing, which we'll get to after this.

[click] Why does this matter so much with agents? Static analysis runs in seconds, and it gives the same answer every time, unlike the model. When an agent runs it after every change, mistakes get fixed before you ever see them. That saves you bugs, time, and tokens.
-->

---
layout: section
---

<div class="eyebrow">2/4 Static Analysis</div>

# Type Checking

<p class="muted">Code that blatantly doesn't make sense</p>

<div class="eyebrow">1/2</div>

<!--
First up, type checking.
-->

---
layout: default
---

## TypeScript

<p class="big">TypeScript is JavaScript with syntax for types.</p>

<p class="big" v-click>Its type checker reads your code and reports what doesn't line up.</p>

<!--
TypeScript is JavaScript with syntax for types. You describe the shapes of your values: what's a string, what might be undefined, what a function takes and returns.

[click] Its type checker reads your code without running it, and reports places where values are used in ways that don't line up with those types. You see those reports as red squiggles in your editor and as errors in CI. Agents can read them too.

Two compiler options do most of the work for catching agent mistakes.
-->

---
layout: default
---

## Example: <code>strictNullChecks</code>

<p class="muted"><code>null</code> and <code>undefined</code> have to be handled</p>

<div class="code-hovers hovers-below">

```ts
let count: number | undefined;

try {
	count = await fetchCount();
} catch (error) {
	console.error("Oh no:", error);
}

console.log(`I have ${count * 2} items.`);
```

<CodeHover :column="22" :length="5" :line="8" :shown="$clicks >= 1" message="'count' is possibly 'undefined'." source="ts(18048)" />

</div>

<p v-click="2">Without it, this compiles, then prints “I have NaN items.” whenever the request fails.</p>

<!--
First up: strictNullChecks.

strictNullChecks means null and undefined have to be handled. Here, count only gets a value if the request succeeds.

[click] So TypeScript won't let you multiply it until you've handled the case where it didn't.

[click] Without strictNullChecks, this compiles just fine. Then the first time the network hiccups, your users see "I have NaN items." And networks do hiccup. Generated code makes this kind of happy-path assumption constantly.
-->

---
layout: default
---

## Example: <code>noImplicitAny</code>

<p class="muted">Every value needs a known type</p>

<div class="code-hovers">

```ts
function formatTalk(talk) {
	return `${talk.title}, by ${talk.speakr}`;
}
```

<CodeHover :column="20" :length="4" :line="0" :shown="$clicks === 1" message="Parameter 'talk' implicitly has an 'any' type." source="ts(7006)" />

</div>

<p v-click="2">Without it, <code>talk</code> is <code>any</code>, so the <code>speakr</code> typo isn't caught.</p>

<!--
noImplicitAny means every value needs a type TypeScript knows. [click] Here, talk has no type annotation, so TypeScript reports an error.

[click] Without noImplicitAny, talk is silently any. Anything goes, including the typo in "speakr". It'll print "undefined" at runtime and nothing will tell you.

Links:

- https://www.typescriptlang.org/tsconfig/#strictNullChecks
- https://www.typescriptlang.org/tsconfig/#noImplicitAny
-->

---
layout: default
---

## Protip: Keep TypeScript Strict

<p class="big"><code>strictNullChecks</code> and <code>noImplicitAny</code> are both on with:</p>

```json
"strict": true
```

<p class="muted">(the default as of TypeScript 6.0)</p>

<p class="big" v-click>Don't let an agent loosen it, or reach for <code>any</code>, to make an error go away.</p>

<!--
Both of those come with "strict": true in your tsconfig. Strict mode, best mode. As of TypeScript 6.0 it's on by default, but plenty of existing projects, and plenty of agent-scaffolded ones, still turn it off. Make sure yours has it. The stricter your types, the more mistakes get caught before anyone reads the code.

[click] And watch for agents loosening it. When a type error is in the way, it's tempting for an agent to turn off a compiler option, or slap an "as any" on the problem. That's the same as disabling a lint rule, which we'll get to in a minute: the error found something real. typescript-eslint's no-explicit-any and no-unsafe rules catch a lot of the "any" part for you.

Links:

- https://www.typescriptlang.org/tsconfig/#strict
- https://devblogs.microsoft.com/typescript/announcing-typescript-6-0/
- https://typescript-eslint.io/rules/no-explicit-any
-->

---
layout: section
---

<div class="eyebrow">2/4 Static Analysis</div>

# Linting

<p class="muted">Code that type checks, but is probably wrong</p>

<div class="eyebrow">2/2</div>

<!--
Next, linting.
-->

---
layout: default
---

## Linters

<p class="big">A linter is a tool that runs a set of checks on your source code.</p>

<p class="big" v-click>Each of those checks is called a "rule".</p>

<!--
A linter is a tool that runs a set of checks on your source code.

[click] Each of those checks is called a "rule". Each rule may report on code it doesn't like, and each complaint may come with an optional autofix. That's free fixes for agents and humans alike.

ESLint is the linter most of you probably use today. Oxlint is a much faster, Rust-based linter that's catching up quickly, and it can run ESLint-style JavaScript plugins, though that support is still in alpha. Sentry's custom lint rules run on Oxlint now.

Lint rules exist for most of that incomplete list from earlier, too: eslint-plugin-jsx-a11y for many of those blatant accessibility issues, for example. Automated checks only find some accessibility issues, though. People find the rest.

Links:

- https://eslint.org
- https://oxc.rs/docs/guide/usage/linter.html
- https://oxc.rs/docs/guide/usage/linter/js-plugins.html
-->

---
layout: default
---

## Example: Initializing State in an Effect

<div class="code-hovers">

````md magic-move {duration: 700, at: 2}
```tsx
function TalkCard({ talk }: TalkCardProps) {
	const [favorite, setFavorite] = useState(false);

	useEffect(() => {
		setFavorite(localStorage.getItem(talk.id) === "true");
	}, [talk.id]);
}
```

```tsx
function TalkCard({ talk }: TalkCardProps) {
	const [favorite, setFavorite] = useState(
		() => localStorage.getItem(talk.id) === "true",
	);
}
```
````

<CodeHover :column="4" :length="11" :line="4" :shown="$clicks === 1" message="Calling setState synchronously within an effect can trigger cascading renders" source="eslint(react-hooks/set-state-in-effect)" />

</div>

<p class="success" :class="{ shown: $clicks >= 2 }">so smart look at you ✅</p>

<style>
.success {
  margin-top: 1rem;
}
</style>

<!--
Here's an example of code that type checks, but is probably wrong. It works. It's also an extra render, and it's a pattern React's docs tell you to avoid. Generated React code does it constantly.

[click] The React Compiler's rules are now in eslint-plugin-react-hooks's recommended config. `set-state-in-effect` flags exactly this: calling setState synchronously within an effect can trigger cascading renders.

[click] And the fix is less code. So smart, look at you.

(If anyone asks: if talk.id can change for the same card, render it with key={talk.id} so the state resets. And with server rendering, reading localStorage during render needs more care, such as useSyncExternalStore.)

Links:

- https://react.dev/reference/eslint-plugin-react-hooks/lints/set-state-in-effect
- https://react.dev/learn/you-might-not-need-an-effect
-->

---
layout: default
---

## Typed Linting

<div class="typed-linting">
<div>

<p class="big">ESLint sees the raw syntax of your code.</p>

<p class="big" v-click="1">TypeScript understands what that code means.</p>

<p class="big" v-click="2">Using types to power up linting is next level power.</p>

</div>

<img alt="Goku from Dragon Ball Z screaming as he powers up into a Super Saiyan" class="saiyan" src="/images/super-saiyan.gif" v-click="4" />

</div>

<div v-click="3">

```ts
export default defineConfig(
	tseslint.configs.recommendedTypeChecked,
	{ languageOptions: { parserOptions: { projectService: true } } },
);
```

</div>

<style>
.typed-linting {
  align-items: center;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1fr auto;
}

.saiyan {
  border-radius: var(--jg-card-radius);
  width: 11rem;
}
</style>

<!--
That rule only needed syntax. But a lot of the most useful rules need more.

ESLint on its own sees the raw syntax of your code.

[click] TypeScript understands what that code means: what every value's type is.

[click] Using types to power up linting is next level power.

[click] Typed linting gives lint rules access to TypeScript's type information. In typescript-eslint, that's the type-checked configs plus the project service. It's slower than syntax-only linting, and it catches a whole category of bugs nothing else does.

[click] Next level power.

Goku: https://giphy.com/gifs/super-saiyan-UBB6f0hKhlShy

Links:

- https://typescript-eslint.io/getting-started/typed-linting
-->

---
layout: default
zoom: 0.9
---

## Example: Detecting Incorrect Async Code

<div class="code-hovers">

````md magic-move {duration: 700, at: 3}
```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running, setRunning] = useState(false);

	async function onClickAndDisable() {
		setRunning(true);
		await onClick();
		setRunning(false);
	}

	return (
		<button disabled={running} onClick={onClickAndDisable}>
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running, setRunning] = useState(false);

	async function onClickAndDisable() {
		setRunning(true); // 💀
		onClick();
		setRunning(false); // 💀
	}

	return (
		<button disabled={running} onClick={onClickAndDisable}>
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running, setRunning] = useState(false);

	async function onClickAndDisable() {
		onClick();
	}

	return (
		<button disabled={running} onClick={onClickAndDisable}>
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running, setRunning] = useState(false);

	function onClickAndDisable() { // 💀
		onClick();
	}

	return (
		<button disabled={running} onClick={onClickAndDisable}>
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running, setRunning] = useState(false);

	return (
		<button disabled={running} onClick={onClick}>
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running] = useState(false); // 💀

	return (
		<button disabled={running} onClick={onClick}>
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	return (
		<button disabled={false} onClick={onClick}> {/* 💀 */}
			click me 🤩
		</button>
	);
}
```

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	return (
		<button onClick={onClick}>
			click me 🤩
		</button>
	);
}
```
````

<CodeHover :column="4" :length="15" :line="5" :shown="$clicks === 1" message="Unexpected `await` of a non-Promise (non-&quot;Thenable&quot;) value." source="eslint(@typescript-eslint/await-thenable)" />

<CodeHover :column="39" :length="19" :line="10" :shown="$clicks === 2" message="Promise-returning function provided to attribute where a void return was expected." source="eslint(@typescript-eslint/no-misused-promises)" />

<CodeHover :column="2" :length="34" :line="3" :shown="$clicks === 4" message="Async function 'onClickAndDisable' has no 'await' expression." source="eslint(@typescript-eslint/require-await)" />

<CodeHover :column="18" :length="10" :line="1" :shown="$clicks === 6" message="'setRunning' is assigned a value but never used." source="eslint(@typescript-eslint/no-unused-vars)" />

</div>

<p class="success" :class="{ shown: $clicks >= 9 }">so smart look at you ✅</p>

<style>
.success {
  margin-top: 0.75rem;
}
</style>

<!--
Let's play one of my favorite programming games: what does this code actually do? Specifically: what does `await onClick()` wait for? (Pause for the room.)

I've been giving this example for years, and it's even more relevant now.

This button component receives an onClick prop. It sets up a running state. When clicked, it sets running to true, awaits the onClick, then sets running to false. The button is disabled while running.

[click] Generated code loves this pattern. But typed linting knows onClick is typed as returning void. So `await onClick()` is awaiting something that isn't a Promise.

(If anyone shouts "but it could be a Promise!": yes, TypeScript lets you pass an async function where a () => void is expected. That's part of what no-misused-promises flags. If waiting really is intended, type the prop as () => Promise<void>, keep the await inside a try/finally, and handle the wrapper's promise at the button, like onClick={() => void onClickAndDisable()}.)

[click] And passing an async function to onClick means a Promise nobody handles.

[click] So drop the await. Now setRunning(true) and setRunning(false) happen synchronously, back to back. Nothing ever sees running as true. 💀

[click] So delete them. Now the async function has no await in it.

[click] So drop the async. Now this function only calls onClick. 💀

[click] So delete the wrapper and pass onClick straight through. Now setRunning is never used.

[click] Remove it. Now running is always false. 💀

[click] So inline false. Now disabled is always false. 💀

[click] Remove that too. And look at what's left.

So smart, look at you. Lint rules flagged four of those steps, and each fix exposed the next simplification.

Links:

- https://typescript-eslint.io/rules/await-thenable
- https://typescript-eslint.io/rules/no-misused-promises
- https://typescript-eslint.io/rules/require-await
- https://typescript-eslint.io/rules/no-unused-vars
-->

---
layout: default
zoom: 0.72
---

## Example: Detecting Incorrect Async Code

<div class="before-after">
<div>

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	const [running, setRunning] = useState(false);

	async function onClickAndDisable() {
		setRunning(true);
		await onClick();
		setRunning(false);
	}

	return (
		<button disabled={running} onClick={onClickAndDisable}>
			click me 🤩
		</button>
	);
}
```

</div>
<div>

```tsx
function MyButton({ onClick }: { onClick: () => void }) {
	return (
		<button onClick={onClick}>
			click me 🤩
		</button>
	);
}
```

<img alt="Santiago from Brooklyn 99 excitedly punching forward with her eyes closed" class="santiago" src="/images/santiago-punch.gif" v-click />

</div>
</div>

<style>
.before-after {
  align-items: start;
  display: grid;
  gap: 1.5rem;
  grid-template-columns: 1.15fr 1fr;
}

.santiago {
  display: block;
  margin: 1.5rem auto 0;
  width: 22rem;
}
</style>

<!--
Before and after. A third of the code, gone, and the bugs with it.

[click] Yes!

That's what static analysis is for: an agent can run these in seconds after every change, and the code gets smaller and more correct each time.
-->

---
layout: default
---

## Protip: Make Disables Explain Themselves

<div class="disables">
<div>

<p class="big">Sometimes disabling a rule is right.</p>

<p class="big" v-click="1">Most of the time it's not.</p>

<p class="big" v-click="3">Every disable should say why.</p>

</div>

<img alt="Comic: a cyclist labeled 'Red editor squigglies' rides along; he puts a stick in his own front wheel labeled 'Disable the linter'; he crashes, labeled 'Why do we have so many bugs?!'" class="bike" v-click="2" src="/images/bike-meme.png" />

</div>

<style>
.disables {
  align-items: start;
  display: grid;
  gap: 2rem;
  grid-template-columns: 1fr auto;
}

.bike {
  height: 24rem;
}
</style>

<!--
Of course, the fastest way to make a lint error go away is to disable the rule.

I'm not going to tell you to never disable the linter. Every project is unique, and sometimes disabling a rule is the right call.

[click] Most of the time it's not. Most of the time, the rule found something real.

[click] And that's how it goes: disable the linter, then wonder where all the bugs came from.

[click] So every disable should say why. That way a reviewer, human or not, can check whether the reason holds up.
-->

---
layout: default
---

## Protip: Make Disables Explain Themselves

```ts
export default defineConfig(
	{ linterOptions: { reportUnusedDisableDirectives: "error" } },
	comments.recommended,
	{
		rules: {
			"@eslint-community/eslint-comments/require-description": "error",
			"@typescript-eslint/ban-ts-comment": "error",
		},
	},
);
```

<!--
So make disables explain themselves. Report unused disable directives. Require a description on every disable comment, so a human can review why. Ban ts-ignore and require a description on ts-expect-error.

This deck's own repo has most of these, by the way. I made it with create-typescript-app.

Links:

- https://eslint.org/docs/latest/use/configure/rules#report-unused-eslint-disable-comments
- https://eslint-community.github.io/eslint-plugin-eslint-comments/rules/require-description.html
- https://typescript-eslint.io/rules/ban-ts-comment
-->

---
layout: default
---

## Protip: Tell Your LLMs to Respect the Linter

<p>Most agents skip static analysis by default. Sentry's <code>AGENTS.md</code> spells it out:</p>

```md
prek is the single entrypoint for all lint, format, and type-checking
tools. Before considering a task complete, run `.venv/bin/prek run -q`
(detects changed files automatically).
…
If a hook fails, fix the issues, stage changes, then re-run until it passes.
```

<p class="source">github.com/getsentry/sentry: AGENTS.md, backend section</p>

<p class="big" v-click>For every report: understand why, then fix the code. Don't silence it.</p>

<!--
Most agents skip static analysis by default. They'll write the code, maybe run the tests, and call it done.

So tell them. Here's the real thing, from Sentry's AGENTS.md. prek is a pre-commit hook runner: it runs our linters and formatters on changed files, frontend included. Before considering a task complete, run it. If a hook fails, fix the issues and re-run until it passes. The frontend section of the same file also tells agents to run "pnpm run typecheck" for TypeScript.

[click] And the part I'd add to any project's instructions: for every report, read it, understand why it happened, and fix the code to respect it. Not "oh, it's complaining, I'll add a disable comment."

Links:

- https://github.com/getsentry/sentry/blob/master/AGENTS.md
- https://github.com/j178/prek
-->

---
layout: default
---

## Protip: Enable All the Lint Rules Relevant to You

<p class="big">Every part of your stack has a plugin.</p>

<p class="big" v-click>Use the strictest configs you can.</p>

<div v-click>

```ts
export default defineConfig(
	eslint.configs.recommended,
	tseslint.configs.strictTypeChecked,
	tseslint.configs.stylisticTypeChecked,
	react.configs.flat.recommended,
	react.configs.flat["jsx-runtime"],
	reactHooks.configs.flat.recommended,
	jsxA11y.flatConfigs.strict,
);
```

</div>

<div class="captioned-gif cowbell" v-click>
  <img alt="SNL's More Cowbell sketch: Will Ferrell gyrating with a cowbell behind Blue Oyster Cult" class="reaction" src="/images/needs-more-lint-rules.gif" />
  <p>Needs more lint rules</p>
</div>

<style>
.cowbell {
  left: 50%;
  position: absolute;
  top: 50%;
  transform: translate(-50%, -50%);
}

.cowbell.slidev-vclick-target {
  transition: none;
}
</style>

<!--
Most projects only turn on a fraction of the lint rules that apply to them. ESLint's own recommended config is a small core.

But every part of your stack probably has a plugin: typescript-eslint for TypeScript, eslint-plugin-react and react-hooks for React and the React Compiler, jsx-a11y for accessibility.

[click] And many plugins ship stricter configs past their recommended ones. Use the strictest ones your team can live with.

[click] Every rule you turn on is one more check that runs on every change, for humans and agents alike.

[click] Is that a lot of lint rules? For most of my career, this has been my answer.

“More Cowbell”: Saturday Night Live

Links:

- https://typescript-eslint.io/users/configs
- https://github.com/jsx-eslint/eslint-plugin-react
- https://github.com/jsx-eslint/eslint-plugin-jsx-a11y
-->

---
layout: default
---

## Protip: Turn Review Comments Into Lint Rules

<p class="big">Left the same review comment twice? Make it a lint rule.</p>

<div class="cards comment-vs-rule" v-click>
  <div>
    <h3>A review comment</h3>
    <p>Reaches one PR, after a human notices.</p>
  </div>
  <div>
    <h3>A lint rule</h3>
    <p>Runs on every change, in the agent's loop.</p>
  </div>
</div>

<div v-click>

<p>Agents are great at writing them. Ask:</p>

```md
Write an ESLint rule that reports raw <table> elements in JSX,
with a message pointing to our design system's <SimpleTable>.
Include RuleTester tests with valid and invalid cases.
```

</div>

<style>
.comment-vs-rule {
  display: grid;
  gap: 2rem;
  grid-template-columns: 1fr 1fr;
  margin: 1.5rem 0 1rem;
}

.comment-vs-rule h3 {
  color: var(--jg-squiggle);
  margin-bottom: 0.4rem;
}

.comment-vs-rule p {
  margin: 0;
}
</style>

<!--
Left the same review comment twice? Make it a lint rule. Shoutout to Tucker Chapin, whose lightning talk this afternoon made the same point.

[click] Here's why. A review comment reaches one PR, and only after a human notices the problem. A lint rule runs on every change, for every human and every agent. And it runs inside the agent's loop: the agent reads the lint message and fixes the code before you ever review it. Every lint rule is a review comment you never have to leave again.

[click] And you don't have to write the rule yourself. Agents are great at writing lint rules. A rule is small and well-specified, there are thousands of examples out there, and every rule comes with tests that check it. So ask: say what to report, what the message should point to, and ask for tests with valid and invalid cases. Then review it like any other PR, and turn it on.

Links:

- https://eslint.org/docs/latest/extend/custom-rules
-->

---
layout: default
---

## Example: A Custom Lint Rule

```js
export default {
	meta: {
		messages: {
			tableElement: "Use SimpleTable instead of a raw <table>.",
		},
	},
	create(context) {
		return {
			"JSXOpeningElement[name.name='table']"(node) {
				context.report({ messageId: "tableElement", node });
			},
		};
	},
};
```

<p class="source">Simplified from Sentry's no-manual-table rule</p>

<!--
Here's roughly what you get back, simplified from a real rule we have at Sentry. Any raw table element in JSX gets flagged, with a message pointing to the right component.

A good lint message is knowledge sharing: it teaches whoever reads it, human or agent, what to do instead.

Remember "copies of the design system"? This is how you stop them for good. If you have existing violations, ESLint's bulk suppressions let you turn the rule on right away and fix those over time.

Links:

- https://github.com/getsentry/sentry/blob/master/static/oxlint/eslintPluginScraps/src/rules/noManualTable.ts
- https://eslint.org/docs/latest/use/suppressions
-->

---
layout: default
---

## Real Examples: Sentry's Custom Lint Rules

<div class="cards sentry-rules">
  <div>
    <h3>no-manual-table</h3>
    <p>Use SimpleTable from '…/simpleTable' instead of a raw &lt;table&gt;.</p>
  </div>
  <div>
    <h3>prefer-stack-for-column-flex</h3>
    <p>Prefer &lt;Stack&gt; over &lt;Flex direction="column"&gt;. …</p>
  </div>
  <div>
    <h3>no-calling-components-as-functions</h3>
    <p>"TalkCard" appears to be a React component. Use &lt;TalkCard /&gt; instead of calling it as a function.</p>
  </div>
  <div>
    <h3>no-unnecessary-use-callback</h3>
    <p>Unnecessary useCallback. <code>onSelect</code> is only used in contexts where memoization provides no benefit. …</p>
  </div>
</div>

<p class="source">github.com/getsentry/sentry: static/oxlint</p>

<style>
.sentry-rules {
  display: grid;
  gap: 1.25rem;
  grid-template-columns: 1fr 1fr;
  margin-bottom: 1rem;
}

.sentry-rules h3 {
  color: var(--jg-squiggle);
  font-family: var(--jg-font-mono);
  font-size: 1.05rem;
  margin-bottom: 0.4rem;
}

.sentry-rules p {
  font-size: var(--jg-size-small);
  margin: 0;
}
</style>

<!--
These aren't hypothetical. Here are a few of Sentry's real custom lint rules, and their real messages, with our example names filled in and trimmed to fit.

no-manual-table is the one from the last slide.

prefer-stack-for-column-flex: we have a Stack component for column layouts, so use it.

no-calling-components-as-functions: render components with JSX, don't call them like plain functions.

And no-unnecessary-use-callback: don't memoize a callback when nothing benefits from the memoization.

Each one is a review comment nobody has to leave anymore. Each message tells the reader, human or agent, exactly what to do instead. Two of these even autofix. Sentry has dozens of these across two internal plugins, and the source is public, so go take a look.

Links:

- https://github.com/getsentry/sentry/tree/master/static/oxlint
-->

---
layout: default
---

<div class="eyebrow">2/4 Static Analysis</div>

## Recap: Is It Written Right?

<div class="recap">
  <span class="muted">You</span>
  <span class="muted">So your agent…</span>
  <strong>Keep TypeScript strict</strong>
  <span>hears about missing null checks and untyped values in seconds</span>
  <strong>Make disables explain themselves</strong>
  <span>has to justify silencing a report</span>
  <strong>Enable all the lint rules relevant to you</strong>
  <span>gets told when code that type checks is probably wrong</span>
  <strong>Turn review comments into lint rules</strong>
  <span>gets your feedback before you review</span>
</div>

<!--
Part two, recapped. The theme: the agent hears about its mistakes in seconds, from a tool, instead of days later, from you.

(Pause a beat, then move on.)
-->

---
layout: center
---

<BugFunnel current="Dynamic Analysis" />

<!--
Part three of four: dynamic analysis. Does it match the spec?
-->

---
layout: default
---

## Common Forms of Dynamic Analysis

<p class="muted">Tooling that scrutinizes code by running it</p>

<div class="cards layers">
  <div v-click>
    <h3>Unit</h3>
    <p>Logic, in isolation</p>
    <p class="muted">Vitest</p>
  </div>
  <div v-click>
    <h3>Integration / E2E</h3>
    <p>The real app, in a real browser</p>
    <p class="muted">Playwright</p>
  </div>
  <div v-click>
    <h3>Ad hoc</h3>
    <p>The agent drives a browser: clicks, reads the console, takes screenshots</p>
    <p class="muted">Chrome DevTools MCP</p>
  </div>
</div>

<style>
.layers {
  display: grid;
  gap: 2rem;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 1.5rem;
}

.layers h3 {
  color: var(--jg-squiggle);
  margin-bottom: 0.5rem;
}
</style>

<!--
Dynamic analysis is tooling that scrutinizes code by running it. There are three common forms here.

[click] Unit tests, such as with Vitest, check logic in isolation. Great, but they don't look at the page.

[click] Integration and end-to-end tests run the real app in a real browser. Playwright, for example.

[click] And then there's ad hoc checking: the agent itself drives a browser. It can click around, read the console, and take screenshots. Chrome DevTools MCP is the tool I use for that.
-->

---
layout: section
---

<div class="eyebrow">3/4 Dynamic Analysis</div>

# Unit Testing

<p class="muted">Testing! Everybody loves it!</p>

<div class="eyebrow">1/2</div>

<!--
First, unit testing. Everybody loves it!
-->

---
layout: default
---

## Tests Are a Snapshot of the Spec

```ts
describe("TalkSearch", () => {
	it("shows matching talks when the user types");
	it("shows 'No results' when nothing matches");
	it("ignores a response when a newer search replaced it");
});
```

<p class="big" v-click>Behavior that isn't specified won't be preserved.</p>

<!--
Here's a way to think about tests: they're a snapshot of the currently specified behavior.

Reading just these test names, you know what this component is supposed to do.

[click] And here's the flip side. Anything not in the spec won't be preserved. If no test says stale responses get ignored, the next change, by a human or an agent, is free to break that.
-->

---
layout: default
---

## Protip: Respect, Add To, and Use the Spec

<div class="cards principles">
  <div v-click>
    <h3>Respect</h3>
    <p>Editing or deleting a test changes the spec.</p>
  </div>
  <div v-click>
    <h3>Add to</h3>
    <p>Every new behavior gets a test. Over time, the spec grows as you understand your product better.</p>
  </div>
  <div v-click>
    <h3>Use</h3>
    <p>Write the test titles first. Then the code.</p>
  </div>
</div>

<!--
So have your agents work with the spec.

[click] Respect it. Editing tests is fine. Deleting tests is fine! But it's a spec change, so make it on purpose, not to make things pass.

[click] Add to it. Every new behavior gets a test, or it isn't in the spec. And over time, the spec should grow, as you understand your product better.

[click] And use it. Write the test titles first, like on the last slide, and have the agent fill them in and then write the code.
-->

---
layout: default
---

## Testing Strategies That Are Much Easier Now

<div class="cards principles">
  <div v-click>
    <h3>Test-driven development</h3>
    <p>Write the tests first, then the code that passes them.</p>
  </div>
  <div v-click>
    <h3>Thorough coverage</h3>
    <p>Edge cases and error states, not just the happy path.</p>
  </div>
  <div v-click>
    <h3>Regression tests</h3>
    <p>Every bug fix gets a test, so the bug stays fixed.</p>
  </div>
</div>

<!--
Writing tests used to be expensive. Now agents can draft them in minutes, so a lot of testing strategies that used to feel like luxuries are much more doable.

[click] Test-driven development: write the tests first, then the code that passes them. That's the "use the spec" idea from a minute ago.

[click] Thorough coverage: edge cases and error states, not just the happy path. It's not about hitting an exact number. It's about testing the things you'd want tested.

[click] And regression tests: every bug fix gets a test, so the bug stays fixed.
-->

---
layout: default
---

## Protip: Name Tests "X when Y"

<div class="test-titles">
  <p class="vague"><code>it("works")</code></p>
  <p class="vague"><code>it("handles empty results")</code></p>
  <div v-click="1">
    <p><code>it("<span class="x">shows matching talks</span> <span class="y">when the user types</span>")</code></p>
    <p><code>it("<span class="x">shows 'No results'</span> <span class="y">when nothing matches</span>")</code></p>
    <p><code>it("<span class="x">ignores a response</span> <span class="y">when a newer search replaced it</span>")</code></p>
  </div>
</div>

<p class="legend" v-click="2"><span class="x">X</span> what happens <span class="y">Y</span> under what condition</p>

<style>
.test-titles p {
  font-size: var(--jg-size-medium);
  margin: 0 0 0.75rem;
}

.test-titles .vague {
  opacity: 0.55;
  text-decoration: line-through;
  text-decoration-color: var(--jg-fg-muted);
}

.test-titles .x,
.legend .x {
  border-bottom: 3px solid var(--jg-squiggle);
  color: var(--jg-squiggle);
}

.test-titles .y,
.legend .y {
  border-bottom: 3px dashed var(--jg-link);
  color: var(--jg-link);
}

.legend {
  font-size: var(--jg-size-medium);
  margin-top: 1.5rem;
}

.legend .x,
.legend .y {
  font-weight: var(--jg-weight-bold);
  margin-left: 1.5rem;
  margin-right: 0.5rem;
}

.legend .x {
  margin-left: 0;
}
</style>

<!--
A small protip that makes a big difference: name tests "X when Y".

Titles like "works" or "handles empty results" don't tell you much. Handles them how?

[click] Instead, be specific. Read these titles in a describe block and you have the spec, including the edge cases.

[click] X is what happens. Y is under what condition. It also makes gaps obvious. If there's a "when" you can think of that isn't there, that's a test to write. Agents follow this pattern well once you tell them to.
-->

---
layout: default
---

## Protip: Arrange, Act, Assert

```tsx {all|2-3|5|7|all}
it("shows 'No results' when nothing matches", async () => {
	render(<TalkSearch talks={talks} />);
	const input = screen.getByRole("searchbox");

	await userEvent.type(input, "zzz");

	expect(screen.getByText("No results")).toBeVisible();
});
```

<p class="aaa">
  <span :class="{ active: $clicks === 1 || $clicks >= 4 }">Arrange</span>
  <span :class="{ active: $clicks === 2 || $clicks >= 4 }">Act</span>
  <span :class="{ active: $clicks === 3 || $clicks >= 4 }">Assert</span>
</p>

<style>
.aaa {
  display: flex;
  font-size: var(--jg-size-large);
  font-weight: var(--jg-weight-bold);
  gap: 2.5rem;
  justify-content: center;
}

.aaa span {
  color: var(--jg-fg-muted);
  opacity: 0.45;
  transition:
    color var(--jg-duration-medium) ease,
    opacity var(--jg-duration-medium) ease;
}

.aaa span.active {
  color: var(--jg-squiggle);
  opacity: 1;
}
</style>

<!--
Another protip for structuring tests, for humans and agents alike: Arrange, Act, Assert.

[click] Arrange: set up everything the test needs. Here, render the component and find the input.

[click] Act: do exactly one thing. Type into the search box.

[click] Assert: check the result. "No results" shows up.

[click] Every test reads the same way, top to bottom. That makes agent-written tests much easier to review, and it makes a test that's secretly doing three things obvious.
-->

---
layout: default
---

## What Not to Test

<div class="cards principles">
  <div v-click>
    <h3>Features that are gone</h3>
    <p>Don't assert that removed code stays removed.</p>
  </div>
  <div v-click>
    <h3>States without logic</h3>
    <p>Static markup, constants, and props passed straight through.</p>
  </div>
  <div v-click>
    <h3>Other people's code</h3>
    <p>Your framework and libraries already have their own tests.</p>
  </div>
</div>

<!--
Cheap tests have a catch: agents will happily write tests that don't need to exist. Every test is code you maintain.

[click] Don't test that features are gone. Once you remove something, a test asserting it's not there is just noise.

[click] Don't test states that contain no logic. Static markup, constants, props passed straight through. If there's no decision being made, there's nothing to get wrong.

[click] And don't test other people's code. React already tests that useState works.
-->

---
layout: section
---

<div class="eyebrow">3/4 Dynamic Analysis</div>

# Beyond Unit Tests

<p class="muted">Look at the actual page</p>

<div class="eyebrow">2/2</div>

<!--
Next, beyond unit tests: integration and end-to-end tests, and agents driving a browser themselves.
-->

---
layout: default
---

## Testing More Than One Piece

<div class="cards principles test-scopes">
  <div>
    <h3>Unit</h3>
    <p>One piece, in isolation.</p>
  </div>
  <div v-click>
    <h3>Integration</h3>
    <p>Pieces working together.</p>
  </div>
  <div v-click>
    <h3>End-to-end</h3>
    <p>The real app in a real browser, used the way a person would.</p>
  </div>
</div>

<style>
.test-scopes {
  grid-template-columns: repeat(3, 1fr);
  margin-top: 1.5rem;
}
</style>

<!--
Unit tests check one piece at a time, in isolation: a function, a hook, a component with everything around it mocked.

[click] Integration tests check pieces working together: a component with its real state and data layer, with only the network faked.

[click] End-to-end tests run the real app in a real browser and use it the way a person would. They're slower, and they catch the bugs that live between the pieces. Those are exactly the bugs an agent misses when it only reads one file at a time.
-->

---
layout: default
---

## Example: An End-To-End Test

```ts
test("favorites survive a reload", async ({ page }) => {
	await page.goto("/talks");
	await page.getByRole("button", { name: "Favorite" }).first().click();

	await page.reload();

	await expect(
		page.getByRole("button", { name: "Favorite", pressed: true }),
	).toBeVisible();
});
```

<p class="big" v-click>It fails when the page is broken, even if every function works.</p>

<!--
Here's what one looks like, in Playwright. Go to the talks page, favorite a talk, reload, and expect it to still be a favorite.

Notice it finds things the way a user does: by role and by name. And "pressed" checks the toggle's aria-pressed state, which is what a screen reader announces. So it doubles as an accessibility check.

[click] And it fails when the page is broken, even if every function in it works on its own. That's the gap between unit tests and what users see.

Agents are good at writing these, and good at running them. Put them in CI, and tell your agent to run them before it says it's done.

Links:

- https://playwright.dev/docs/locators
-->

---
layout: default
---

## Agents Can Drive a Browser, Too

<p class="big">Tests check the flows you thought to write down.</p>

<p class="big" v-click>A browser lets an agent check the flow it just changed.</p>

<!--
End-to-end tests check the flows you thought to write down ahead of time.

[click] But agents can also drive a browser directly, while they work. That lets an agent check the flow it just changed: click through it, look at it, read the console. Before it tells you it's done.
-->

---
layout: default
---

## Example: Giving the Agent a Browser

```json
{
	"mcpServers": {
		"chrome-devtools": {
			"command": "npx",
			"args": ["-y", "chrome-devtools-mcp@latest"]
		}
	}
}
```

```md
Open localhost:3000/talks, favorite a talk, and reload.
Screenshot the result, and check the console for errors.
```

<!--
Setting it up is a few lines of MCP config. This is straight from the Chrome DevTools MCP readme.

Then you can ask for runtime checks in plain language: open the page, favorite a talk, reload, screenshot it, and check the console.

That's how you find out whether "favorites survive a reload" is actually true.

Links:

- https://github.com/ChromeDevTools/chrome-devtools-mcp
-->

---
layout: statement
---

# "All checks pass."

<p class="muted">An agent, about a page it never looked at</p>

<!--
Here's something you'll hear from agents a lot, about frontend changes: "All checks pass."

Raise your hand if an agent has told you all checks pass, and the page was broken. (Pause.) This was a test. Everybody should be raising their hand.
-->

---
layout: center
---

<img alt="Tim Robinson sarcastically asking: YOU SURE ABOUT THAT?" class="reaction" src="/images/tim-robinson-you-sure.gif" />

<!--
You sure about that?

“You sure about that?”: Tim Robinson, I Think You Should Leave
-->

---
layout: default
---

## Protip: Actually Verify Outputs

<p class="big" v-click>Reasoning about code isn't running it.</p>

<div class="cards principles" v-click>
  <div>
    <h3>Ask for evidence</h3>
    <p>Screenshots, console output, and network requests from the running page.</p>
  </div>
  <div>
    <h3>Look at it yourself</h3>
    <p>The screen is the spec your users see.</p>
  </div>
</div>

<!--
Agents verify their own work by reasoning about it all the time: "The code says this should work, so it does." Checks pass, the math looks right, and the page is still broken.

[click] Reasoning about code isn't running it. A unit test, or a model reading its own code, can say "this should work." Only the screen says whether it does.

[click] So ask for evidence from the running page: screenshots, console output, network requests. And look at it yourself.
-->

---
layout: statement
---

# The best testing is in production.

<p class="muted" v-click>(Please be gentle to your users.)</p>

<!--
Here's a slightly spicy one: the best testing is in production. That's the only place with your real users, real data, and real devices.

[click] Please be gentle to your users. They didn't sign up to be your test suite.
-->

---
layout: default
---

## Protip: Watch What Users Actually Hit

<div class="cards principles prod-signals">
  <div>
    <h3>Errors</h3>
    <p>Real exceptions, with stack traces and how many people hit them.</p>
  </div>
  <div>
    <h3>Performance</h3>
    <p>Slow pages and requests, traced across services.</p>
  </div>
  <div>
    <h3>Replays</h3>
    <p>What someone saw and did right before it broke.</p>
  </div>
</div>

<p class="big" v-click>Agents can read these too, through MCP servers like Sentry's.</p>

<style>
.prod-signals {
  grid-template-columns: repeat(3, 1fr);
  margin: 1.5rem 0;
}
</style>

<!--
So watch what users actually hit, with an observability or monitoring tool. You want errors with real stack traces and counts, performance traces for slow pages and requests, and replays of what someone saw and did right before it broke.

[click] And agents can read these too. Sentry has an MCP server, and so do other observability tools. Point an agent at a real production issue and it starts from evidence instead of a guess.

Full disclosure: I work at Sentry, and this is the thing we build. Whatever you use, use something.

Links:

- https://mcp.sentry.dev
-->

---
layout: default
---

<div class="eyebrow">3/4 Dynamic Analysis</div>

## Recap: Does It Match the Spec?

<div class="recap">
  <span class="muted">You</span>
  <span class="muted">So your agent…</span>
  <strong>Respect, add to, and use the spec</strong>
  <span>hits a failing test when it changes behavior you care about</span>
  <strong>Test in a real browser</strong>
  <span>checks the page, not just the code</span>
  <strong>Actually verify outputs</strong>
  <span>shows you screenshots, not just "All checks pass."</span>
  <strong>Watch what users actually hit</strong>
  <span>starts from real errors instead of guesses</span>
</div>

<!--
Part three, recapped. The theme: don't take the agent's word for it. Run the code, and look at the result.

(Pause a beat, then move on.)
-->

---
layout: center
---

<BugFunnel current="Peer Review" />

<!--
Part four of four: peer review. Is the spec correct?
-->

---
layout: section
---

<div class="eyebrow">4/4 Peer Review</div>

# Humans

<p class="muted">That means you</p>

<div class="eyebrow">1/2</div>

<!--
First, humans. That means you.
-->

---
layout: default
---

## Is the Spec Correct?

<p class="big">Tools check the code against the spec. Only people can check the spec against what users need.</p>

<p class="accent cta" v-click>Have a human review every PR that ships to real users.</p>

<style>
.cta {
  font-size: var(--jg-size-subtitle);
  font-weight: var(--jg-weight-bold);
  margin-top: 1.5rem;
  white-space: nowrap;
}
</style>

<!--
Types, lint, and tests all answer the funnel's earlier questions: is it written right, and does it match the spec?

But the last question is different. Tools check the code against the spec. Only people can check the spec against what users actually need. That's the most valuable part of review now.

[click] Have a human review every PR that ships to real users. Spend that review time on the plan and the tests, not just the diff.
-->

---
layout: default
---

## Example: A Spec Change in Disguise

<p class="muted">"Fixed the failing test. All checks pass."</p>

```diff
 it("shows 'No results' when nothing matches", async () => {
 	render(<TalkSearch talks={talks} />);
 	const input = screen.getByRole("searchbox");

 	await userEvent.type(input, "zzz");

-	expect(screen.getByText("No results")).toBeVisible();
+	expect(screen.queryByText("No results")).toBeNull();
 });
```

<p class="big" v-click>The tests pass because the spec changed. Only a person can say whether it should have.</p>

<!--
Here's what that looks like. Watch out for this one.

The agent says: "Fixed the failing test. All checks pass." And they do pass! Because it changed what the test expects. The title still says it shows "No results". The assertion now says it doesn't.

[click] None of your CI checks will fail on this, because the tests are the thing that changed. An AI reviewer might notice, if you're lucky. But the tests verify the code, and only a human can verify the tests. So when you review an agent's PR, read the test changes first.
-->

---
layout: section
---

<div class="eyebrow">4/4 Peer Review</div>

# Skills

<p class="muted">Again!</p>

<div class="eyebrow">2/2</div>

<!--
Second, skills. Again!
-->

---
layout: default
---

## Protip: Distill Repeated Work Into Skills

<p class="big">Do something often? Have an agent distill it into a skill.</p>

<div class="cards principles">
  <div v-click>
    <h3>Gather</h3>
    <p>Point it at your past work: reviews, PRs, docs.</p>
  </div>
  <div v-click>
    <h3>Distill</h3>
    <p>Have it find the patterns and write them up as a skill.</p>
  </div>
  <div v-click>
    <h3>Test</h3>
    <p>Run the skill on real cases it hasn't seen, and compare.</p>
  </div>
</div>

<!--
If you do something often, have an agent distill it into a skill.

[click] Gather: point it at your past work. Your review comments, your PRs, your docs.

[click] Distill: have it find the recurring patterns and write them up as a skill.

[click] Test: run the skill on real cases it hasn't seen, and compare against what you'd actually do.
-->

---
layout: default
---

## Example: lint-rule-review-skill

<p class="muted">I've reviewed a lot of lint rules. So I distilled those reviews into a skill.</p>

<div class="distill-stats">
  <div>
    <strong>3,092</strong>
    <span>of my review comments on lint rule PRs</span>
  </div>
  <div>
    <strong>178</strong>
    <span>patterns, each citing the comments behind it</span>
  </div>
  <div>
    <strong>Hundreds</strong>
    <span>of improvements found at Sentry</span>
  </div>
</div>

<div class="cards protip" v-click><div>Writing custom lint rules? Review them with github.com/JoshuaKGoldberg/lint-rule-review-skill</div></div>

<style>
.distill-stats {
  display: grid;
  gap: 2rem;
  grid-template-columns: repeat(3, 1fr);
  margin-top: 1.5rem;
}

.distill-stats strong {
  color: var(--jg-squiggle);
  display: block;
  font-size: var(--jg-size-title);
  line-height: 1.1;
}

.distill-stats span {
  font-size: var(--jg-size-small);
}

.protip {
  margin: 2rem 0 0.5rem;
}

.protip > div {
  border-color: var(--jg-hairline);
  padding: 1rem 1.5rem;
}
</style>

<!--
Here's what that looks like for me. I've reviewed a lot of lint rules over the years: ESLint, typescript-eslint, and Flint. So I followed those same three steps.

Gather: I had an agent collect my past review comments on lint rule pull requests. Thousands of them. I was not about to read those myself.

Distill: from 3,092 of those comments, it found 178 recurring patterns, like "match by declaration, not by name," and wrote them up as a skill. Every pattern cites the real comments it came from.

Test: I held back some real reviews, and scored the skill against those. Then we rolled it out at Sentry, and it found hundreds of improvements in our custom lint rules. Not a replacement for a human reviewer, but a very good first pass.

[click] So if you're writing custom lint rules, like we talked about earlier, run them through this skill.

Links:

- https://github.com/JoshuaKGoldberg/lint-rule-review-skill
-->

---
layout: default
---

## Instructions Are Guidance

<div class="evidence">
<div>

<p class="muted">My agent instructions</p>

```md
Never add the trailing "🤖 Generated with Claude Code".
```

</div>
</div>

<!--
One more lesson about skills and instructions in general.

My personal agent instructions say never to add a "Generated with Claude Code" line to pull requests.
-->

---
layout: center
---

<img alt="Qui-Gon Jinn from Star Wars saying: I wish that were so" class="reaction" src="/images/qui-gon-wish.gif" />

<!--
I wish that were so.

“I wish that were so”: Qui-Gon Jinn, Star Wars: Episode I
-->

---
layout: default
---

## Instructions Are Guidance

<div class="evidence">
<div>

<p class="muted">My agent instructions</p>

```md
Never add the trailing "🤖 Generated with Claude Code".
```

</div>
<div v-click>

<p class="muted">One of my PRs, a few days ago</p>

```md
Turns on `typescript/no-unnecessary-type-arguments` ...

🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

</div>
</div>

<style>
.evidence {
  display: grid;
  gap: 1.5rem;
}
</style>

<!--
Here are my instructions again.

[click] Here's one of my pull requests from a few days ago. It has the line.
-->

---
layout: center
---

<img alt="April from Parks and Recreation, wide-eyed in disbelief, pressing her fingers to her temples at her desk" class="reaction" src="/images/april-disbelief.gif" />

<!--
Are you kidding me.

“Stressed”: https://giphy.com/gifs/parksandrec-episode-5-parks-and-recreation-rec-76Nahzjx4Y6WXP2APE
-->

---
layout: statement
---

# Instructions are suggestions.

<p v-click>Anything that has to happen every time belongs in a lint rule, a type, a test, or CI.</p>

<!--
Instructions are suggestions. The agent might follow them. It might not.

[click] Anything that has to happen every time belongs in a lint rule, a type, a test, or CI. Not just in a prompt.
-->

---
layout: default
clicks: 4
---

<div class="never" :class="`step-${$clicks}`">
  <div aria-hidden="true" class="never-wall">
    <div v-for="row in 14" :key="row">NEVER TRUST AN AI · NEVER TRUST AN AI · NEVER TRUST AN AI · NEVER TRUST AN AI</div>
  </div>
  <h1 class="never-text">Never trust an AI.</h1>
  <p class="never-footnote">* This deck was made with AI. Double-check everything in it.</p>
</div>

<style>
.never {
  display: grid;
  inset: 0;
  overflow: hidden;
  place-content: center;
  position: absolute;
  text-align: center;
}

.never-wall {
  color: rgb(119 187 255 / 0%);
  display: grid;
  font-size: 1.6rem;
  font-weight: var(--jg-weight-bolder);
  gap: 0.35rem;
  inset: -4rem;
  position: absolute;
  transform: rotate(-8deg);
  transition: color var(--jg-duration-slowest) ease;
  white-space: nowrap;
}

.never-wall div:nth-child(even) {
  margin-left: -6rem;
}

.never-text {
  font-size: var(--jg-size-title);
  position: relative;
  text-shadow: var(--jg-text-shadow);
  transition:
    font-size var(--jg-duration-slowest) ease,
    line-height var(--jg-duration-slowest) ease;
}

.step-1 .never-text,
.step-2 .never-text {
  font-size: 5.5rem;
  text-transform: uppercase;
}

.step-2 .never-wall {
  color: rgb(119 187 255 / 14%);
}

.step-3 .never-text,
.step-4 .never-text {
  font-size: 10.5rem;
  line-height: 0.9;
  text-transform: uppercase;
}

.step-3 .never-wall,
.step-4 .never-wall {
  color: rgb(0 163 255 / 28%);
}

.never-footnote {
  background: var(--jg-bg-bottom);
  bottom: 1.25rem;
  color: var(--jg-fg);
  font-size: 1rem;
  opacity: 0;
  padding: 0.35rem 0.75rem;
  position: absolute;
  right: 2rem;
  transition: opacity var(--jg-duration-medium) ease;
}

.step-4 .never-footnote {
  opacity: 1;
}
</style>

<!--
So I want to be very clear about something.

Never trust an AI.

[click] NEVER trust an AI.

[click] Not for the code. Not for the tests. Not for the PR description. Not for the summary of the PR description.

[click] NEVER. TRUST. AN AI.

[click] (Pause.) This deck was made with AI, by the way. So double-check everything I just told you.
-->

---
layout: default
---

<div class="eyebrow">4/4 Peer Review</div>

## Recap: Is the Spec Correct?

<div class="recap">
  <span class="muted">You</span>
  <span class="muted">So your agent…</span>
  <strong>Have a human review what ships</strong>
  <span>has its spec checked against what users need</span>
  <strong>Distill repeated work into skills</strong>
  <span>gets a first-pass review that knows your patterns</span>
  <strong>Rules in CI</strong>
  <span>gets stopped by CI, not just asked nicely</span>
</div>

<!--
Part four, recapped. The theme: tools check the code, and people check the spec. Let's close out.
-->

---
layout: center
---

## "The Bug Acquisition Funnel"

<BugFunnel />

<!--
None of this gets you to zero bugs. Nothing does. The best you can do is get asymptotically close.

But every stage of the funnel catches bugs the others miss. It would be foolish to write off any one stage for not catching every bug on its own. And how much of each you need depends on what you're building: a weekend side project is not the Mars rover.

We've been building these stages for years, long before agents showed up. They're how you check the guesses.
-->

---
layout: default
---

## Protips <span class="emoji">📸</span>

<div class="protips">
  <p>Prompt precisely: plan, context, review.</p>
  <p>Keep coding by hand.</p>
  <p>Facts in <code>AGENTS.md</code>, procedures in skills, rules in CI.</p>
  <p>Keep TypeScript strict.</p>
  <p>Make disables explain themselves.</p>
  <p>Tell your LLMs to respect the linter.</p>
  <p>Enable all the lint rules relevant to you.</p>
  <p>Turn review comments into lint rules.</p>
  <p>Respect, add to, and use the spec.</p>
  <p>Test in a real browser.</p>
  <p>Actually verify outputs.</p>
  <p>Watch what users actually hit.</p>
  <p>Distill repeated work into skills.</p>
  <p>Have a human review what ships.</p>
  <p>Needs more lint rules.</p>
  <p>Never trust an AI.</p>
</div>

<style>
.protips {
  column-gap: 3rem;
  columns: 2;
  margin-top: 1.5rem;
}

.protips p {
  break-inside: avoid;
  font-size: var(--jg-size-medium);
  margin: 0 0 0.9rem;
}
</style>

<!--
These are photo-capable slides, if you want.

The main protips from today, in one place. Including a classic: needs more lint rules.
-->

---
layout: default
---

## 🔗

<div class="cards links">
  <div>
    <h3>Skills</h3>
    <p><a href="https://agentskills.io">agentskills.io</a></p>
    <p><a href="https://github.com/getsentry/skills">github.com/<wbr />getsentry/<wbr />skills</a></p>
    <p><a href="https://github.com/anthropics/skills">github.com/<wbr />anthropics/<wbr />skills</a></p>
    <p><a href="https://github.com/JoshuaKGoldberg/lint-rule-review-skill">github.com/<wbr />JoshuaKGoldberg/<wbr /><span class="nowrap">lint-rule-review-skill</span></a></p>
  </div>
  <div>
    <h3>Static Analysis</h3>
    <p><a href="https://typescriptlang.org">typescriptlang.org</a></p>
    <p><a href="https://typescript-eslint.io">typescript-eslint.io</a></p>
    <p><a href="https://eslint.org">eslint.org</a></p>
    <p><a href="https://oxc.rs">oxc.rs</a> <span class="muted">(Oxlint)</span></p>
    <p><a href="https://github.com/getsentry/sentry/tree/master/static/oxlint">github.com/<wbr />getsentry/<wbr />sentry/<wbr />tree/<wbr />master/<wbr />static/<wbr />oxlint</a></p>
  </div>
  <div>
    <h3>Dynamic Analysis</h3>
    <p><a href="https://vitest.dev">vitest.dev</a></p>
    <p><a href="https://playwright.dev">playwright.dev</a></p>
    <p><a href="https://github.com/ChromeDevTools/chrome-devtools-mcp">github.com/<wbr />ChromeDevTools/<wbr /><span class="nowrap">chrome-devtools-mcp</span></a></p>
    <p><a href="https://mcp.sentry.dev">mcp.sentry.dev</a></p>
  </div>
</div>

<style>
.links {
  display: grid;
  gap: 2rem;
  grid-template-columns: 1.3fr 1fr 1.3fr;
  margin-top: 2rem;
}

.links h3 {
  color: var(--jg-squiggle);
  margin-bottom: 1rem;
}

.links .nowrap {
  white-space: nowrap;
}

.links p {
  font-size: var(--jg-size-small);
  line-height: 1.3;
  margin-bottom: 0.75rem;
}
</style>

<!--
The main tools and skills I talked about, in one place. Many slides' notes also link to the docs behind them, so grab the slides afterward if you want to dig in.
-->

---
layout: cover
---

# Thank you! <span class="emoji">💖</span>

<p class="thanks-handle">@ JoshuaKGoldberg .com</p>

<img alt="QR code linking to hi.joshuakgoldberg.com" class="thanks-qr" src="/images/qr-hi-joshuakgoldberg.png" />

<style>
.thanks-handle {
  color: var(--jg-link);
  font-size: var(--jg-size-large);
  margin-top: 2rem;
}

.thanks-qr {
  margin: 2rem auto 0;
  width: 8.5rem;
}
</style>

<!--
Thanks very much to you for listening, and to the React Summit organizers and MCs for a great day! You can reach me on Bluesky, Fosstodon, and dot com at JoshuaKGoldberg. The QR code goes to all of those, and the slides are on joshuakgoldberg.com/speaking.

Make AI write better code. Thanks everyone, enjoy the evening!
-->
