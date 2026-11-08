# Handshake — Devpost draft

## Tagline

Learn ASL fingerspelling, starting with the people you want to talk to.

## Inspiration

Learning a language can start with one person: a friend, a family member, or a coworker you want to connect with. We built Handshake around that motivation.

Our starting question was simple: what if your first fingerspelling lesson began with a name that already meant something to you? Instead of starting with an abstract list of letters, Handshake starts with your own name and builds toward spelling the name of the person you are learning for.

We wanted to make those first steps feel personal and approachable, while giving beginners something concrete to work on when practising a handshape.

## What it does

Handshake is a browser-based ASL learning prototype focused on fingerspelling. You enter your name, the name of someone you want to communicate with, and your signing hand. The app turns that starting point into a lesson path through your name and the alphabet, with references, practice steps, and saved progress.

During camera practice, Handshake compares your handshape with recorded references. It uses hand landmarks to identify differences in finger curl, direction, or placement, then asks Gemini to turn those measurements into a short coaching cue. If you keep struggling, the coaching can offer a different explanation. Practice-word suggestions use letters you have learned, with attention to letters that need more work.

The prototype also includes assisted introductory signs and a scripted first-hello scene. These are early exercises, not an assessment of conversational ASL. Moving letters J and Z are reference-only, and the enabled static-letter comparisons have not yet completed our independent human validation gate. We describe a detection as “matches our recording.”

The progress page shows practice activity and reference-match rates over the last 14 days, including letters that may need more review. Learners can also opt in to weekly email recaps or invite the person they are learning for to receive lesson-completion updates. Each recipient must explicitly confirm the relevant email link before updates are enabled, and every update includes an unsubscribe link.

## How we built it

We built the interface with React, TypeScript, and Vite, with Three.js and React Three Fiber for interactive hand references.

The recognition pipeline runs in the browser. MediaPipe extracts 21 hand landmarks, which we smooth and convert into features describing the hand's shape. The recognizer supports a trained model through TensorFlow.js and a nearest-neighbour fallback over recorded templates. Voting across frames and requiring a held pose help prevent a single unstable frame from becoming a match.

We separated recognition from explanation: **MediaPipe measures your hands; Gemini coaches you.** An Express backend sends structured feedback to Gemini for coaching and requests practice words from eligible letter sets. Gemini does not decide whether a sign passes. Cached coaching is labeled, so the interface can distinguish a fallback from a generated response.

Names, profile information, and local progress stay in the browser. The coaching flow uses letter targets and measured feedback rather than sending names or a webcam video stream.

Tiger Data stores anonymous practice attempts in a TimescaleDB hypertable. The Express API aggregates those attempts into daily statistics and frequently missed items. We verified attempt submission and statistics retrieval through the public HTTPS API. Email addresses and subscription state are stored separately from attempt records in a notification schema; the current deployment uses the same Tiger Data database for both schemas.

n8n runs four active workflows for subscriptions, confirmation and unsubscribe links, lesson updates, and weekly recaps. The workflows check consent, sending limits, and delivery state before sending through a configured Gmail SMTP credential. We verified the live workflow paths with controlled email sinks, including separate/shared inboxes, multi-learner recaps, and delivery failures. Real inbox delivery remains a final verification step.

Vultr hosts the Express API behind Caddy HTTPS, with systemd managing the process. GitHub Actions automatically tests each production push and deploys the exact tested commit. The release process includes HTTPS checks and guarded rollback on health-check failure. Successful production deployments and the public API were verified; rollback failure paths were tested locally.

For model development, we implemented a Databricks notebook that compares three neural-network configurations and logs their metrics and artifacts to MLflow. The best evaluated candidate can be exported for browser inference after review. The training pipeline is locally tested, but we have not yet verified a Databricks workspace run or attributed an accuracy improvement to it. Agent-assisted planning also has a local fallback; a live Maritime deployment is not part of our verified results.

## Challenges we ran into

Handshape recognition was the biggest technical challenge. Similar letters can differ by a small finger position, and the same handshape looks different across people and camera angles. We added landmark smoothing, voting across frames, and lesson-specific candidate sets to make the comparisons less sensitive to momentary variation. Those safeguards do not replace testing with people who did not record the training examples; that validation remains a priority.

Another challenge was giving AI a useful, well-defined role. A confident explanation is not evidence that a sign is right. We grounded coaching in measured hand feedback and kept the recognition decision separate from the language model.

We also had to distinguish progress through an exercise from successful recognition. Skipping a step should not silently award mastery. The lesson flow tracks unfinished practice so that progress represents what the learner actually completed.

Connecting the services introduced another challenge: saving an email address is not the same as receiving consent or delivering a message. We added separate confirmation flows, single-use expiring tokens, sending limits, and subscription rechecks. We also tested failures explicitly so a failed send does not get recorded as successful delivery. Gemini quota limits reinforced the need for usable local coaching fallbacks.

## Accomplishments we're proud of

We brought a personal learning path, browser-based hand tracking, interactive references, and AI coaching into one prototype. The experience starts with a reason to learn and connects that reason to the next small practice step.

We are especially proud of the boundary between measurement and coaching. It gives Gemini a concrete job—making feedback easier to understand—while keeping the app's match decisions tied to the recognition pipeline.

We also built a guest-first experience with locally saved progress, so a learner can begin without creating an account.

Beyond the lesson interface, we connected live practice analytics, deployed consent-based email workflows, and verified automated backend releases with checks before and after deployment.

## What we learned

Building a recognizer and building a learning experience are different problems. A model output needs to become a useful next action: which finger to adjust, what reference to look at, or when to try again.

We learned to distinguish matching a recorded handshape from demonstrating language ability. Fingerspelling is only one part of ASL; movement, facial expression, grammar, and understanding another signer all matter. That distinction shaped both our technical design and the language we use in the app.

We also learned that personalization can be simple. Starting with a familiar name gives an otherwise generic alphabet exercise a concrete purpose. Whether that improves motivation or learning is something we want to test with learners.

## What's next for Handshake

Our next priority is reviewing the references and exercises with Deaf and ASL-fluent reviewers, then testing recognition with people who did not contribute the original recordings. We want to document where comparisons work, where they fail, and which letters are ready for dependable practice.

We also want to interview beginners about the name-first learning path, test keyboard and assistive-technology flows, and improve feedback for different hands, camera positions, and lighting conditions.

From there, we can refine the assisted greetings and conversation exercises, complete real inbox-delivery checks, and run the training notebook in Databricks with a baseline evaluated on the same data. We also want to make notification confirmation and service availability clearer in the interface. Our aim is to support early practice alongside instruction from Deaf teachers, with a clear understanding of what the app can assess.

## Built with

React, TypeScript, Vite, MediaPipe, TensorFlow.js, Three.js, React Three Fiber, Node.js, Express, Google Gemini API, Python, scikit-learn, MLflow, Tiger Data, PostgreSQL, TimescaleDB, n8n, Vultr, Caddy, systemd, GitHub Actions.

---

## Submission notes — do not paste into the project story

- Add the verified public app URL, repository URL, demo video, and team contributions.
- No interviews are recorded in `docs/notes.md`; the inspiration above is the team's design premise, not a research finding or user testimonial.
- `frontend/src/cv/practiceable.ts` enables the 24 static alphabet letters and the open-hand “5” shape. `docs/test-log.md` has no human gate results. Do not claim validated accuracy or measured learning gains.
- Check the final demo against this draft, especially assisted greetings and the first-hello scene. Remove any feature that is not included in the submitted build.
- Use [the 2026-11-08 integration evidence](evidence/2026-11-08-integration-gaps.md) for the verified Tiger Data, n8n runtime and Vultr deployment claims. Real inbox delivery, a Databricks cloud run and a live Maritime planner are still unverified. Do not claim that Databricks improved model accuracy without a measured comparison.
- Confirm the final enabled privacy settings before submission. If snapshots are enabled, disclose hand-photo transfer. If notifications are demonstrated, describe their consent and data flow separately.
- Live Gemini coaching and practice-word responses were observed, but the configured model subsequently exhausted its free-tier request quota. Restore available quota before recording the final AI demo; retain visible fallback labels. Do not describe all Gemini endpoints as currently verified live.
- Repository branch protection still needs administrator setup. The notification wording changes are local until the frontend source is published. Check the final submitted build rather than assuming it contains every worktree change.
