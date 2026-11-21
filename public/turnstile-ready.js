window.overtureTurnstileReady = () => {
  window.dispatchEvent(new Event("overture:turnstile-ready"));
};
