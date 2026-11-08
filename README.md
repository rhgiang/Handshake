# Handshake

**Learn ASL fingerspelling, starting with the people you want to talk to.**

Handshake is a browser-based learning prototype that helps beginners practise American Sign Language (ASL) fingerspelling. It starts with your name and the name of someone you want to communicate with, then builds a lesson path through the alphabet and introductory signing exercises.

**Try it:** [handshake-frontend.vercel.app](https://handshake-frontend.vercel.app/#/). Allow camera access when asked.

## What you can do

- **Start with a familiar name.** Practise the letters in your own name before working through alphabet handshape families and spelling the name of the person you are learning for. Learning for yourself? Skip the second name in onboarding and the path leaves out that person's name lesson.
- **Short, mixed lessons.** Each new letter is signed once, then practised in a mix: a "Which letter is this?" exercise that needs no camera, then signing the letters again from memory in random order. One practice word per lesson, and a missed "Which letter" question comes back once at the end.
- **Recall practice with a way out.** Some steps hide the reference on purpose so you practise remembering the handshape. A placeholder says so, and Hint (a written how-to from Gemini) then Show answer reveal more when you are stuck. Hints never change whether a sign matches.
- **Follow visual references.** Use handshape instructions and interactive 3D hand references to explore finger positions.
- **Practise with your webcam.** The app compares your handshape with recorded references and provides feedback about finger curl, direction, and placement. If it reads your hand as a look-alike (for example S when you are signing A), it tells you so live.
- **Get coaching from Gemini.** AI turns measured hand feedback into short practice cues and suggests words using letters you have learned. Cached coaching is labeled when a live response is unavailable.
- **Try introductory exercises.** Assisted greetings and a scripted first-hello scene introduce a few steps beyond the alphabet.
- **Keep your progress.** Lessons, XP, and practice history help you track your progress, and completed lessons turn green on your path. Every lesson screen has Home and Back to your path links, and progress is saved as you match. You can start as a guest without creating an account.

## How it works

**MediaPipe measures your hands; Gemini coaches you.**

MediaPipe detects hand landmarks in your browser. A recognizer compares the handshape with recorded references, using multiple frames and a held pose to reduce unstable detections. Gemini explains the measured feedback; it does not decide whether a sign passes.

The frontend uses React, TypeScript, and Vite. The backend uses Node.js and Express for Gemini requests and optional integrations. Hand recognition runs in the browser with MediaPipe and TensorFlow.js, with a recorded-template fallback.

## Current scope

Handshake is a hackathon prototype. Its static-letter comparisons have not yet completed independent human validation, so a detection means **“matches our recording,”** not verified signing accuracy. Moving letters J and Z are reference-only. Greetings and the first-hello scene are introductory exercises, not an assessment of conversational fluency.

ASL includes movement, facial expression, grammar, and understanding other signers. Handshake supports early practice alongside instruction from Deaf teachers; it is not a complete ASL course.

## Privacy

Your names, profile, progress, and mistake history are stored locally in your browser. Ordinary webcam practice processes hand landmarks in the browser, and coaching uses letter targets and measured feedback rather than names or a webcam video stream.

Optional integrations can store anonymous practice attempts or support consent-based email notifications. These require separate configuration and live verification.

## Run locally

```bash
npm run install:all
cp .env.example .env
npm run dev
```

Open **http://localhost:5173**. The API runs on port **8787**.

You can try the app without API keys using cached coaching. To enable live Gemini responses, set `GEMINI_API_KEY` in the root `.env` file. Keep that key on the backend.

Allow camera access when prompted. Webcam access works on `localhost`; a public deployment requires HTTPS.

## Branches and deployment

`main` is the development branch. The live site runs from the `production` branch: the frontend is deployed by Vercel and the backend by a GitHub Actions workflow on pushes to `production`. Do not merge `main` into `production`; promote reviewed, compatible changes selectively (see [backend/deploy/CICD.md](backend/deploy/CICD.md)).

## Development

```bash
npm run build    # Build the frontend
npm test         # Run frontend, backend, and agent tests
```

The main folders are:

- `frontend/` — lessons, interface, hand tracking, and recognition.
- `backend/` — API, Gemini coaching, and optional practice storage.
- `training/` — tools for training the handshape model.
- `agent/` — optional practice-planning agent.
- `n8n/` — optional notification workflows.
- `docs/` — project plans, validation notes, and submission materials.

For optional service setup, see the [backend documentation](backend/README.md), [planner documentation](agent/README.md), and [notification documentation](n8n/README.md). The [integration status](docs/evidence/status.md) distinguishes local implementation from verified live deployment.
