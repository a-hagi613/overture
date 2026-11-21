export const turnstileBrowserStub = `
(() => {
  const passToken = "XXXX.DUMMY.TOKEN.XXXX";
  const behaviorUrl = "/__test__/turnstile/browser";
  const widgets = new Map();
  const counts = { executes: 0, renders: 0, resets: 0, removes: 0 };
  let nextId = 1;
  let behavior = { delayMs: 25, mode: "pass" };

  async function refreshBehavior() {
    try {
      const response = await fetch(behaviorUrl, { headers: { accept: "application/json" } });

      if (response.ok) {
        behavior = await response.json();
      }
    } catch {
      behavior = { delayMs: 25, mode: "pass" };
    }
  }

  function fail(widget) {
    const mode = behavior.mode;

    if (mode === "error") {
      widget.options["error-callback"]?.("stub-error");
    } else if (mode === "timeout") {
      widget.options["timeout-callback"]?.();
    } else if (mode === "expired") {
      widget.options["expired-callback"]?.();
    }
  }

  async function executeWidget(widget) {
    await refreshBehavior();

    const mode = behavior.mode;

    if (mode === "hang") {
      return;
    }

    try {
      window.setTimeout(() => {
        if (widget.settled) {
          return;
        }

        if (mode !== "pass") {
          fail(widget);

          return;
        }

        widget.settled = true;
        widget.input.value = passToken;
        widget.options.callback?.(passToken);
      }, behavior.delayMs);
    } catch {
      widget.options["error-callback"]?.("stub-error");
    }
  }

  window.turnstile = {
    render(element, options) {
      counts.renders += 1;

      const id = "stub-" + String(nextId);
      const input = document.createElement("input");

      nextId += 1;
      input.name = "cf-turnstile-response";
      input.type = "hidden";
      input.value = "";
      element.append(input);

      widgets.set(id, { element, id, input, options, settled: false });

      return id;
    },
    execute(id) {
      const widget = widgets.get(id);

      if (widget === undefined) {
        return;
      }

      counts.executes += 1;
      void executeWidget(widget);
    },
    reset(id) {
      counts.resets += 1;

      const widget = widgets.get(id);

      if (widget !== undefined) {
        widget.input.value = "";
        widget.settled = false;
      }
    },
    remove(id) {
      counts.removes += 1;

      const widget = widgets.get(id);

      if (widget !== undefined) {
        widget.input.remove();
        widgets.delete(id);
      }
    },
  };

  window.turnstileStub = {
    counts() {
      return { ...counts };
    },
    mode() {
      return behavior.mode;
    },
  };
})();
`;
