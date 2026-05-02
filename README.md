# CareerReady 🚀

**AI-powered job application assistant for students aged 16–24.**

CareerReady helps first and second-time job seekers build a resume, analyse job postings, write cover letters, and prep for interviews — all in one place, all powered by Claude AI.

Built by [@Skirtz](https://github.com/Skirtz)

---

## What it does

**6 steps. One complete application.**

| Step | What happens |
|------|-------------|
| 👤 Profile | Tell it your name, school, city, and job type |
| 📄 Resume | Build from scratch or paste an existing one for AI review |
| 🎯 Job Analysis | Paste any job posting — get ATS score, keyword gaps, company research, match % |
| 📋 Documents | AI-generated resume + cover letter, hallucination-checked |
| 💬 Interview Prep | 5 questions, 2 scenarios, 1 curveball, smart questions to ask |
| 🎉 Summary | Full summary of everything you built |

---

## Features

- **ATS keyword analysis** — checks your resume against the actual keywords companies screen for
- **Company-specific keywords** — knows Home Depot's Pro Xtra, Best Buy's Geek Squad, Walmart+, and 14 other major retailers
- **Hallucination check** — every claim in your generated resume is verified against what you told it. It never invents experience you don't have
- **Objective vs Summary detection** — automatically picks the right format based on your experience level
- **Hidden experience discovery** — 5 questions that find experience you didn't know you had
- **Quantification prompts** — asks "how many customers per shift?" to make bullets specific
- **Running ATS score** — shows your projected score as you toggle keyword improvements
- **Hire probability** — realistic estimate of your chances with a specific fix to improve it
- **LinkedIn advisory** — before/after advice for every section of your LinkedIn profile
- **Resume Freshness Tracker** — tells you when your resume needs updating
- **Auto-saves everything** — close the tab and come back, nothing is lost
- **3 saved resume versions** — keep different resumes for different job types
- **↑↓ reordering** — drag experience, education, and activities into any order
- **Practice mode** — type your answer to any interview question and get feedback

---

## How to run it

### Option 1 — Claude.ai (easiest, no setup)
1. Go to [claude.ai](https://claude.ai)
2. Start a new chat
3. Upload `CareerReady.jsx`
4. The app runs live in the chat

### Option 2 — Standalone HTML (share with anyone)
1. Open `CareerReady_combined.html` in any browser
2. Enter your [Anthropic API key](https://console.anthropic.com) (free $5 credit on signup)
3. Full app runs locally — no server needed

### Option 3 — No API key required (host it yourself)
1. Deploy `cloudflare-worker.js` to [Cloudflare Workers](https://workers.cloudflare.com) (free — 100k requests/day)
2. Add your `ANTHROPIC_API_KEY` as an encrypted secret in the Worker settings
3. Replace `YOUR_WORKER_URL_HERE` in `CareerReady_proxy.html` with your Worker URL
4. Host `CareerReady_proxy.html` anywhere — users need no API key

---

## Files

```
CareerReady/
├── CareerReady.jsx              # Main app — use this in Claude.ai
├── CareerReady_combined.html    # Standalone: marketing site + app in one file
├── CareerReady_proxy.html       # Standalone: no API key required (needs worker)
├── cloudflare-worker.js         # Cloudflare Worker proxy (hides your API key)
├── index.html                   # Marketing website only (Home, Pricing, Contact)
└── README.md                    # This file
```

---

## Tech stack

- **React 18** — UI framework
- **Tailwind CSS** — styling
- **Anthropic Claude API** — all AI features (`claude-sonnet-4-20250514`)
- **Babel Standalone** — compiles JSX in the browser (no build step)
- **localStorage** — persistent storage across sessions
- **Cloudflare Workers** — optional serverless proxy

No backend. No database. No npm install. No build step. One file.

---

## AI architecture

Each AI-heavy stage is split into focused API calls to avoid token limits:

- **Stage 3 (Job Analysis):** 2 calls — keywords/scores (2500 tokens) + fit/company (2000 tokens)
- **Stage 5 (Interview Prep):** 2 calls — questions/scenarios (2000 tokens) + curveball/questions-to-ask (1000 tokens)
- **All calls:** use `safeJSON()` — 4-strategy resilient parser that handles truncated or malformed responses

---

## Screenshots

> Coming soon — video demo on LinkedIn

---

## Roadmap

- [ ] Cross-device sync (account system)
- [ ] Browser extension for Indeed/LinkedIn job scraping
- [ ] Application history tracker
- [ ] Cover letter ATS score gate (90+ required)
- [ ] More company keyword maps

---

## License

MIT — do whatever you want with it.

---

*Built with Claude AI. Designed for students who are nervous about applying for their first job.*
