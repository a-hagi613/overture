export const labScript = `(() => {
  const body = document.body;
  const status = document.querySelector("[data-lab-status]");
  const score = document.querySelector("[data-lab-score]");
  const challenge = body.dataset.labChallenge ?? "pass";
  let settled = false;

  const setStatus = (value, detail) => {
    if (settled && value !== "passed") {
      return;
    }

    if (value === "passed") {
      settled = true;
    }

    if (status !== null) {
      status.dataset.labStatus = value;
      status.textContent = detail ?? value;
    }
  };

  const markPassed = () => {
    if (challenge === "blocked") {
      return;
    }

    setStatus("passed", "The challenge passed");
  };

  window.overtureLabChallengePassed = markPassed;

  if (body.dataset.labPage === "recaptcha_v3") {
    if (challenge === "blocked") {
      setStatus("blocked", "The challenge stayed visible");
      return;
    }

    const endpoint = body.dataset.labScoreEndpoint ?? "/lab/recaptcha/score";

    const execute = () => {
      const grecaptcha = window.grecaptcha;

      if (grecaptcha === undefined) {
        setStatus("error", "The vendor script did not load");

        return;
      }

      grecaptcha.ready(() => {
        grecaptcha
          .execute(body.dataset.labSitekey ?? "", { action: body.dataset.labAction ?? "lab" })
          .then(async (token) => {
            const response = await fetch(endpoint, {
              body: JSON.stringify({ token }),
              headers: { "content-type": "application/json" },
              method: "POST",
            });
            const verdict = await response.json();

            if (verdict.success !== true) {
              setStatus("blocked", "The score check refused the token");
              return;
            }

            if (score !== null) {
              score.dataset.labScore = String(verdict.score);
              score.textContent = "Score " + String(verdict.score);
            }

            setStatus("passed", "The challenge passed");
          })
          .catch(() => {
            setStatus("error", "The challenge could not run");
          });
      });
    };

    execute();
    return;
  }

  if (body.dataset.labPage === "hcaptcha" || body.dataset.labPage === "turnstile") {
    if (challenge === "blocked") {
      setStatus("blocked", "The challenge stayed visible");
      return;
    }

    setTimeout(() => {
      if (!settled) {
        setStatus("blocked", "The challenge stayed visible");
      }
    }, 15000);
  }
})();
`;

export const labStylesheet = `:root { color-scheme: light dark; font-family: system-ui, sans-serif; }
body { background: #f3eee4; color: #151311; margin: 0; }
main { margin: 0 auto; max-width: 42rem; padding: 2.5rem 1.25rem 4rem; }
h1 { font-size: 1.9rem; line-height: 1.15; margin: 0 0 1rem; }
label { display: block; font-size: 0.9rem; margin: 0.9rem 0 0.3rem; }
input { box-sizing: border-box; display: block; font: inherit; margin-top: 0.3rem; max-width: 100%; padding: 0.55rem; width: 100%; }
button { font: inherit; margin-top: 1.25rem; padding: 0.7rem 1.1rem; }
.lab-challenge { border: 1px solid #151311; margin: 1rem 0; padding: 1.25rem; }
.lab-note { color: #5e5850; font-size: 0.85rem; }
.lab-key { color: #5e5850; font-family: ui-monospace, monospace; font-size: 0.8rem; }
.lab-blocked { color: #8e3a2c; }
@media (prefers-color-scheme: dark) {
  body { background: #191714; color: #f2ede4; }
  .lab-note, .lab-key { color: #ada69b; }
  .lab-challenge { border-color: #f2ede4; }
}
`;
