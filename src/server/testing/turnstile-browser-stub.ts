export const turnstileBrowserStub = `
(() => {
  const passToken = "XXXX.DUMMY.TOKEN.XXXX";
  const behaviorUrl = "/__test__/turnstile/browser";
  const widgets = new Map();
  const counts = { executes: 0, renders: 0, resets: 0, removes: 0, shows: 0 };
  let nextId = 1;
  let behavior = { delayMs: 25, mode: "pass" };
  let lastRender = null;

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

  function isInteractionOnly(options) {
    return options.appearance === "interaction-only";
  }

  function showWidget(widget) {
    if (widget.box.hidden) {
      widget.box.hidden = false;
      counts.shows += 1;
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

    if (mode === "interaction" || !isInteractionOnly(widget.options)) {
      showWidget(widget);
    }

    window.setTimeout(() => {
      if (widget.settled) {
        return;
      }

      if (mode !== "pass" && mode !== "interaction") {
        fail(widget);

        return;
      }

      widget.settled = true;
      widget.input.value = passToken;

      if (isInteractionOnly(widget.options)) {
        widget.box.hidden = true;
      }

      widget.options.callback?.(passToken);
    }, behavior.delayMs);
  }

  function createBox() {
    const box = document.createElement("div");

    box.hidden = true;
    box.setAttribute("data-turnstile-stub", "widget");
    box.style.cssText = [
      "align-items:center",
      "background:#fafafa",
      "border:1px solid #8a8a8a",
      "border-radius:4px",
      "box-sizing:border-box",
      "color:#3a3a3a",
      "display:flex",
      "font:12px/1.3 system-ui,sans-serif",
      "height:65px",
      "justify-content:center",
      "width:300px",
    ].join(";");
    box.textContent = "Turnstile · test key";

    return box;
  }

  window.turnstile = {
    render(element, options) {
      counts.renders += 1;

      const id = "stub-" + String(nextId);
      const input = document.createElement("input");
      const box = createBox();

      nextId += 1;
      input.name = "cf-turnstile-response";
      input.type = "hidden";
      input.value = "";
      element.append(box);
      element.append(input);
      lastRender = { appearance: options.appearance, execution: options.execution, action: options.action };

      widgets.set(id, { box, element, id, input, options, settled: false });

      if (!isInteractionOnly(options)) {
        showWidget(widgets.get(id));
      }

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
        widget.box.hidden = isInteractionOnly(widget.options);
      }
    },
    remove(id) {
      counts.removes += 1;

      const widget = widgets.get(id);

      if (widget !== undefined) {
        widget.box.remove();
        widget.input.remove();
        widgets.delete(id);
      }
    },
  };

  window.turnstileStub = {
    counts() {
      return { ...counts };
    },
    expire() {
      for (const widget of widgets.values()) {
        widget.input.value = "";
        widget.settled = false;
        widget.options["expired-callback"]?.();
      }
    },
    lastRender() {
      return lastRender;
    },
    mode() {
      return behavior.mode;
    },
  };
})();
`;
