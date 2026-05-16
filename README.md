# CareerReady 🚀

**AI-powered job application assistant for students aged 16–24.**

CareerReady helps first and second-time job seekers build a resume, analyse job postings, write cover letters, and prep for interviews — all in one place, all powered by Claude AI.

Built by [@Skirtz](https://github.com/Skirtz)

---

## Live Demo

> Coming soon — deploy instructions below

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
- **Company-specific keywords** — knows Home Depot's Pro Xtra, Best Buy's Geek Squad, Walmart+, and 14 major retailers
- **Hallucination check** — every claim in your generated resume is verified. It never invents experience you don't have
- **Objective vs Summary detection** — automatically picks the right format based on your experience level
- **Hidden experience discovery** — 5 questions that find experience you didn't know you had
- **Quantification prompts** — asks "how many customers per shift?" to make bullets specific
- **Running ATS score** — shows your projected score as you toggle keyword improvements
- **Hire probability** — realistic estimate with a specific fix to improve it
- **LinkedIn advisory** — before/after advice for every section of your LinkedIn profile
- **Resume Freshness Tracker** — tells you when your resume needs updating
- **Auto-saves everything** — close the tab and come back, nothing is lost
- **Download resume** — download as `.txt` or formatted `.html` (open in browser → Ctrl+P → Save as PDF)
- **3 saved resume versions** — keep different resumes for different job types

---

## Files

```
CareerReady/
├── CareerReady.jsx              # Main app — use this in Claude.ai for testing
├── CareerReady_combined.html    # Full site: landing page + app in one file
├── CareerReady_proxy.html       # No API key required version (needs Cloudflare Worker)
├── cloudflare-worker.js         # Cloudflare Worker proxy (hides your API key)
├── index.html                   # Marketing website only (Home, Pricing, Contact)
└── README.md                    # This file
```

---

## How to run it

### Option 1 — Claude.ai (no setup, instant)
1. Go to [claude.ai](https://claude.ai)
2. Start a new chat
3. Upload `CareerReady.jsx`
4. The app runs live in the chat — no API key needed

### Option 2 — Host it free on Netlify (recommended)
The easiest way to get a permanent public URL in under 2 minutes:

1. Go to [app.netlify.com](https://app.netlify.com) and sign up free with GitHub
2. Click **Add new site → Import an existing project → GitHub**
3. Select your `CareerReady` repo
4. Set **Publish directory** to `.` (just a dot)
5. Click **Deploy site**
6. Netlify gives you a live URL like `https://careerready.netlify.app`
7. Every time you push to GitHub, Netlify auto-deploys — no manual uploads ever again

Your `CareerReady_combined.html` is the file users will land on. Rename it to `index.html` in your repo for Netlify to serve it automatically as the homepage.

### Option 3 — GitHub Pages (also free)
1. Go to your repo → **Settings → Pages**
2. Source: **Deploy from a branch**
3. Branch: `main`, folder: `/ (root)`
4. Save — your site is live at `https://skirtz.github.io/CareerReady`
5. Rename `CareerReady_combined.html` to `index.html` so it loads as the homepage

### Option 4 — No API key version
1. Deploy `cloudflare-worker.js` to [Cloudflare Workers](https://workers.cloudflare.com) (free — 100k req/day)
2. Add your `ANTHROPIC_API_KEY` as an encrypted environment variable
3. Replace `YOUR_WORKER_URL_HERE` in `CareerReady_proxy.html` with your Worker URL
4. Host `CareerReady_proxy.html` — users need no API key at all

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

## How to get a PDF of your resume

Since the app runs in a browser, the best way to save your resume as a PDF is:

1. Click **⬇ Download formatted** in the Documents tab
2. Open the downloaded `.html` file in your browser
3. Press **Ctrl+P** (Windows) or **Cmd+P** (Mac)
4. Change destination to **Save as PDF**
5. Click Save

---

## License

MIT — do whatever you want with it.

---

*Built with Claude AI. Designed for students who are nervous about applying for their first job.*
