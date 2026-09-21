# Hosting the board for your collaborators (Vercel)

This page is for sharing your project's board with people who read it in a plain web browser and don't use Claude Code themselves. `/aict:board --publish-web` puts a private, password-protected copy of your board on Vercel, a hosting service. Setting it up takes about 20 minutes once. After that, publishing an update takes one click, and a collaborator's whole experience is: open a link, type a password, read, and comment.

The sections below cover, in order: the message to send your collaborators, how to install what you need, what this costs, what to do if something goes wrong, moving to a new computer, what a collaborator actually sees, retiring an old GitHub Pages board if you had one, what happens (and doesn't happen) when you read collaborator comments, and what data this involves.

## The invitation to send your collaborators

Once your board is published, send something like this. Fill in the bracketed parts, then send the password separately, in a different email or message.

```
Subject: Feedback on [project name]

Hi [name],

I'd like your feedback on [one sentence describing the project, e.g. "the plan and early results for our study on X"]. I've set up a private webpage where you can read it and leave comments.

Link: [URL]

The page will ask for a password. That's coming in a separate message, not this one.

To leave a comment: select any text with your mouse, then click "Comment" and type your note.

Please sign your comments with your full name, so I know who wrote what.

One thing to know: your comments are visible to the other collaborators, so keep that in mind when you write yours.

This works best on a computer. It may not work well on a phone.

If it asks for the password again later, that's normal, it's the same password, not a new one.

Please keep this email. You may need the link again later.

Thanks so much for taking the time.

[Your name]
```

## Step 0: install Node.js

The rest of this tool only needs Python, which most computers already have. Hosting the board is the one part that also needs Node.js, a separate program that runs the Vercel tool. Install it once, before you publish for the first time.

- Easiest path: go to nodejs.org, download the installer marked "LTS" for your operating system, and run it, accepting the defaults.
- On a Mac with Homebrew already installed, you can instead open Terminal and run `brew install node`.

After installing, close and reopen your terminal window (or restart Claude Code) so it picks up the new program.

Once Node is installed, tell Claude Code to run `/aict:board --publish-web`. Claude handles most of the setup itself, and pauses at a couple of points to ask you to do something only you can do: log into Vercel in your own terminal window (not inside Claude Code), and choose when to send collaborators the password, separately from the link. See Time and cost below for what to expect.

Before the first deploy, enable firewall rate limiting for the login route in your project's Vercel Firewall settings. This setup is required. It is the primary defense against repeated password guesses. Do not publish the board until the rule is enabled.

## Time and cost

The first setup takes about 20 minutes, mostly spent installing Node and logging into Vercel once. After that, publishing an update is one click and takes a few seconds.

Hosting itself is free. Vercel's free "Hobby" plan covers what a small research board needs, for personal, noncommercial use, which covers a typical academic project.

Two things worth checking before you rely on this:

- The free plan is for noncommercial use. If your project has any commercial angle, you'll need a paid Vercel plan instead.
- If your project involves a grant, an IRB protocol, or regulated data, check with your institution or your IRB about whether hosting board content on Vercel's servers fits your data agreement, before you publish anything.

## If something goes wrong

**"Node not found," or something similar.** Node.js isn't installed yet, or your terminal can't find it. Go back to Step 0, install it, then close and reopen your terminal.

**A permission error mentioning "npm i -g" or "EACCES."** This happens when Node was installed in a way that blocks new users from installing programs globally. You likely won't hit this: Claude runs the Vercel tool through `npx`, which doesn't need a global install. If you do see it, the simplest fix is reinstalling Node from nodejs.org rather than trying to repair the permissions yourself.

**The login link expired, or it logged into the wrong account.** The link from `vercel login` is only good for a few minutes. If it expired, just run `vercel login` again. If it opened in the wrong browser account, log out of that account first, or open the link in a private or incognito browser window, then run `vercel login` again.

**Publishing said it succeeded, but a collaborator sees "404 Not Found."** Check that the link you sent matches the one Claude reported after publishing, exactly, an extra space or a missing character breaks it. If the link is right, ask Claude to publish again; publishing repeatedly is safe and always updates the same page.

**A collaborator forgot the password.** Don't resend the old one over email. Ask Claude to rotate the password (say "reset the board password," or run `--set-password`). This creates a new password and immediately signs out everyone using the old one, which is also the right move if you're worried the old password reached someone it shouldn't have. Send the new password the same careful way you sent the first one, separately from the link.

## New computer?

If you move to a new laptop, or start a fresh Claude Code session on a different machine, you don't need to redo the whole setup. Tell Claude "reconnect the board," or run `--web-connect`. This finds the board you already published and reconnects your local setup to it. Only redo Step 0's full first-time setup if you're starting a genuinely new board, not reconnecting to one that already exists.

## What your collaborators experience

When you send the link and the password, here's what a collaborator sees, step by step:

1. A plain login page asking for a password. They type the password you sent separately and press a button. There's no account and no sign-up.
2. After logging in, they see the same board you see, the plan, the results, the comments. To leave a comment, they select text with their mouse, and a small "Comment" button appears. They type a note, and it's saved right away.
3. If they come back later, the page may ask for the password again. That's a normal security check, not a sign of a problem, and it's the same password every time.

Screenshots of the login page and an in-progress comment will be added here in a later update. Until then, if a collaborator is unsure what to expect, walk them through it once by phone or video call, or forward them the invitation template above, which describes each step.

## Taking down the old GitHub Pages board

Earlier versions of this tool published boards to GitHub Pages, a public page with no password. If you ever ran `--publish`, that page is still live and still public. Anyone with the link can read it, indefinitely, until you take it down. Now that you're using the private Vercel board instead, take the old one down:

- The thorough fix: delete the `gh-pages` branch. In a terminal, in your project folder, run `git push origin --delete gh-pages`. Once the branch is gone, there's nothing left that someone could accidentally turn back on.
- The quicker fix: on GitHub, open your repository's Settings, then Pages, and set Source to None. This turns the page off but leaves the branch in place, so someone else with access to your repository's settings could re-enable it later without realizing it was meant to stay private.

Either way, GitHub's servers can keep serving a cached copy of the old page for a while after you take it down, so don't assume it disappears the instant you act.

## What silence means

When new collaborator comments are pulled into your Claude Code session (either you ask for this, or Claude does it as part of your normal workflow), those comments are cleared from the hosted board. Your collaborator has no way of knowing this happened. To them, their comment may simply seem to have vanished, with nothing telling them it was received or read.

Close that loop yourself:

- Reply by email once you've acted on their feedback, e.g. "thanks, I made that change" or "I looked into this and here's why I kept it as is."
- Or republish the board after making changes, so a collaborator who checks back sees their feedback reflected in the plan or results.

Don't leave a collaborator wondering whether anyone read what they wrote.

## Data and privacy

Be clear with yourself, and with your collaborators, about what hosting the board involves.

Vercel, the company hosting your board, processes:

- your board's content: the plans, results, and any figures or tables you've captured
- every comment a collaborator writes
- collaborators' IP addresses and basic access logs, e.g. when someone visited and roughly where from

This data sits on Vercel's servers, not on your own computer, for as long as the board stays published.

**Where the data is stored is fixed early, so choose deliberately.** The first time you set this up, the tool creates a storage location (Vercel calls it a "Blob store") in a specific geographic region. That region doesn't change once the store is created. If your project is subject to data residency rules, e.g. GDPR in the EU, or a specific requirement from your IRB or funder, ask Claude which region is being used before you publish for the first time, and pick deliberately rather than accepting a default.

**Deleting everything.** You can remove any of this whenever you want:

- To delete every comment collaborators have left, while keeping the board itself running, say "clear all board comments," or run `--web-clear`. This cannot be undone.
- To take the whole board down, including the hosting project itself, remove it from your Vercel account, either by running `vercel remove` from a terminal, or by deleting the project from Vercel's own dashboard at vercel.com. This deletes the board, its comments, and its stored data together.
