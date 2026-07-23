# Human Guide: Steering Your AI Workspace

Welcome. This system is designed to act as a "map" for your AI assistant, ensuring it stays focused and follows your engineering standards.

## 1. The Philosophy: You are the Pilot
The AI is a probabilistic reasoning engine. It is excellent at writing code but lacks "situational awareness." 
- **You (The Pilot)**: Provide **Intent** (The 'What' and 'Why') and **Verification** (The 'Is it right?').
- **AI (The Co-Pilot)**: Provides **Implementation** (Writing the code).

---

## 2. Initial Setup
Based on your local configuration:
1.  **Start Ollama**: Ensure your runtime is active (`ollama list`).
2.  **Model**: You are using `qwen2.5-coder:14b` (or 32b).
3.  **Aider Ready**: Ensure Aider is installed and configured to point to your local Ollama endpoint (`export OLLAMA_API_BASE=http://127.0.0.1:11434`).

---

## 3. The Core Engineering Loop (The 4 Steps)

Follow these steps for every task to maintain a clean and stable codebase.

### Step 1: Focus (Set the Steering)
Open `.ai/CURRENT_STATE.md`. Update the **Current Focus** section with your immediate goal.
> *Example: "Refactoring the authentication middleware to use JWT."*
This prevents the AI from drifting into unrelated files.

### Step 2: Bundle (Prepare the Map)
Run the context packaging script:
```bash
./scripts/ai-context.sh
```
This gathers your rules (`AGENTS.md`), your focus (`CURRENT_STATE.md`), and a summary of your files into a single compact file at `.ai/context/current_bundle.md`.

### Step 3: Session (The Work)
Start Aider and feed it the bundle:
```bash
# Start Aider with your local model
aider --model ollama/qwen2.5-coder:14b

# Inside Aider:
> "Read .ai/context/current_bundle.md. Implement the first task in .ai/TASKS.md. Follow the rules in AGENTS.md strictly."
```

### Step 4: Verify (The Quality Gate)
Once the AI finishes, run your deterministic checks:
```bash
./scripts/verify.sh
```
**Never commit AI code that hasn't passed verification.**

---

## 4. Where is Everything? (The Tour)

### The "Cognition Layer" (`.ai/`)
This is the AI's memory. If it gets confused, point it back here.
- **`CURRENT_STATE.md`**: Your steering wheel. Keep it updated.
- **`TASKS.md`**: Your roadmap. Help the AI check these off.
- **`DECISIONS.md`**: Your "Why". Log architectural choices here so the AI doesn't "fix" them later.
- **`plans/`**: For complex features, have the AI write a plan here *before* it touches code.

### The "Rule Book" (`AGENTS.md`)
This contains your coding standards. If the AI keeps making the same mistakes, **add a rule here**. The AI is forced to read this every time you bundle context.

### The "Automations" (`scripts/`)
- **`ai-context.sh`**: Packages the repo state so you don't overwhelm the AI's context window.
- **`verify.sh`**: Your "Did I break it?" button.

---

## 5. Safety & Git Strategy
1.  **Always use Feature Branches**: `git checkout -b ai/task-name`.
2.  **Block main**: Ensure you review every AI change before merging into main.
3.  **Surgical Edits**: Don't let the AI touch 10 files at once. Keep requests scoped to 1-2 files.
4.  **Markdown is Memory**: If it's not in a Markdown file, the AI will eventually forget it. If it's important, write it down in `.ai/`.
