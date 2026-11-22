const passer = `
const blocked = () => document.body.dataset.labChallenge === "blocked";

const pass = () => {
  if (!blocked() && typeof window.overtureLabChallengePassed === "function") {
    window.overtureLabChallengePassed("lab-token");
  }
};

document.addEventListener("DOMContentLoaded", () => {
  if (!blocked()) {
    setTimeout(pass, 0);
  }
});
`;

export const labRecaptchaStub = `
window.grecaptcha = {
  execute: () => Promise.resolve("lab-recaptcha-token"),
  ready: (callback) => setTimeout(callback, 0),
};
`;

export const labHcaptchaStub = `
window.hcaptcha = {
  getResponse: () => (document.body.dataset.labChallenge === "blocked" ? "" : "lab-hcaptcha-token"),
  render: () => "lab-hcaptcha-widget",
};
${passer}
`;

export const labTurnstileStub = `
window.turnstile = {
  getResponse: () => (document.body.dataset.labChallenge === "blocked" ? "" : "lab-turnstile-token"),
  render: () => "lab-turnstile-widget",
};
${passer}
`;
