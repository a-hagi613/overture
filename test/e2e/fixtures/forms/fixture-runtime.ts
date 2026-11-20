const countryOptions = ["Canada", "United Kingdom", "United States"].map((label) => ({
  label,
  value: label,
}));

interface RecordedOption {
  label: string;
  value: string;
}

interface FixtureMeta {
  options: Record<string, RecordedOption[]>;
  autocompletes?: string[];
  jobLocation: string;
  confirmationMessage: string;
  confirmationPath?: string;
}

declare global {
  var fixtureMeta: FixtureMeta | undefined;
}

const optionsFor = (meta: FixtureMeta, fieldId: string) => {
  const recorded = meta.options[fieldId];

  if (recorded !== undefined) {
    return recorded;
  }

  if (fieldId === "country") {
    return countryOptions;
  }

  if (fieldId === "candidate-location") {
    return [{ label: meta.jobLocation, value: meta.jobLocation }];
  }

  return null;
};

const closeListbox = (field: HTMLInputElement, listbox: HTMLElement) => {
  listbox.hidden = true;
  field.setAttribute("aria-expanded", "false");
};

const chooseOption = (
  field: HTMLInputElement,
  listbox: HTMLElement,
  hiddenInput: HTMLInputElement,
  option: HTMLElement,
) => {
  const label = option.textContent;
  const value = option.dataset.value ?? "";

  hiddenInput.setAttribute("value", value);
  closeListbox(field, listbox);

  const container = field.closest(".select__container");

  let chosen =
    container === null ? null : container.querySelector<HTMLElement>(".select__single-value");

  if (chosen === null) {
    chosen = document.createElement("div");
    chosen.className = "select__single-value";

    const placeholder =
      container === null ? null : container.querySelector<HTMLElement>(".select__placeholder");

    if (placeholder !== null) {
      placeholder.hidden = true;
    }

    field.parentElement?.append(chosen);
  }

  chosen.textContent = label;

  const choice = new URLSearchParams({ fieldId: field.id, value });

  void fetch(`/__fixture__/choice?${choice.toString()}`);
};

const openListbox = (field: HTMLInputElement, listbox: HTMLElement) => {
  listbox.hidden = false;
  field.setAttribute("aria-expanded", "true");
};

const renderOptions = (
  field: HTMLInputElement,
  listbox: HTMLElement,
  listboxId: string,
  hiddenInput: HTMLInputElement,
  options: RecordedOption[],
) => {
  listbox.replaceChildren();

  for (const [optionIndex, option] of options.entries()) {
    const item = document.createElement("li");

    item.id = `${listboxId}-option-${String(optionIndex)}`;
    item.setAttribute("role", "option");
    item.dataset.value = option.value;
    item.textContent = option.label;

    item.addEventListener("click", (event) => {
      event.preventDefault();
      chooseOption(field, listbox, hiddenInput, item);
    });

    listbox.append(item);
  }
};

const setupCombobox = (
  field: HTMLInputElement,
  hiddenInput: HTMLInputElement,
  options: RecordedOption[],
  autocomplete: boolean,
) => {
  const listbox = document.createElement("ul");
  const listboxId = `react-select-${field.id}-listbox`;

  listbox.id = listboxId;
  listbox.setAttribute("role", "listbox");
  listbox.hidden = true;

  renderOptions(field, listbox, listboxId, hiddenInput, options);

  field.setAttribute("aria-controls", listboxId);

  const shell = field.closest(".select-shell") ?? field.parentElement;

  shell?.append(listbox);

  if (autocomplete) {
    field.addEventListener("input", () => {
      const query = field.value.trim().toLowerCase();

      const matched =
        query === ""
          ? []
          : options.filter((option) => option.label.toLowerCase().startsWith(query));

      renderOptions(field, listbox, listboxId, hiddenInput, matched);

      if (matched.length === 0) {
        closeListbox(field, listbox);

        return;
      }

      openListbox(field, listbox);
    });
  } else {
    field.addEventListener("click", () => {
      openListbox(field, listbox);
    });
  }

  field.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeListbox(field, listbox);
    }
  });

  document.addEventListener("click", (event) => {
    if (event.target instanceof Node && shell !== null && !shell.contains(event.target)) {
      closeListbox(field, listbox);
    }
  });
};

const showCodePanel = (form: HTMLFormElement) => {
  const panel = document.querySelector<HTMLElement>("#verification_code");

  if (panel === null) {
    return;
  }

  panel.hidden = false;
  form.append(panel);
};

const showErrors = (form: HTMLFormElement, lines: string[]) => {
  for (const line of lines) {
    const node = document.createElement("div");

    node.className = "field-error";
    node.textContent = line;
    form.prepend(node);
  }
};

const showConfirmation = (form: HTMLFormElement, html: string) => {
  form.remove();

  const confirmation = document.createElement("div");

  confirmation.id = "application_confirmation";
  confirmation.innerHTML = html;

  const main = document.querySelector<HTMLElement>("main") ?? document.body;

  main.append(confirmation);
};

const attachComboboxes = (form: HTMLFormElement, meta: FixtureMeta) => {
  for (const field of form.querySelectorAll<HTMLInputElement>("input[role='combobox']")) {
    const options = optionsFor(meta, field.id);

    if (options === null) {
      continue;
    }

    const hidden = document.createElement("input");

    hidden.type = "hidden";
    hidden.name = field.id;
    form.append(hidden);
    setupCombobox(field, hidden, options, meta.autocompletes?.includes(field.id) ?? false);
  }
};

const attachResumeEcho = (form: HTMLFormElement) => {
  const input = form.querySelector<HTMLInputElement>("input[type='file']");

  if (input === null) {
    return;
  }

  input.addEventListener("change", () => {
    const file = input.files?.[0];

    if (file === undefined) {
      return;
    }

    const body = new FormData();

    body.set("resume", file);

    void fetch("/__fixture__/resume", { method: "POST", body });
  });
};

const prepareNativeSubmit = (form: HTMLFormElement) => {
  form.setAttribute("action", `${form.getAttribute("action")}/application`);
  form.setAttribute("method", "post");
};

const attachSubmitBehaviour = (form: HTMLFormElement, meta: FixtureMeta) => {
  attachResumeEcho(form);

  const search = new URLSearchParams(globalThis.location.search);

  if (search.get("native") === "1") {
    prepareNativeSubmit(form);

    return;
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    const action = `${form.getAttribute("action")}/application${globalThis.location.search}`;

    void (async () => {
      try {
        const response = await fetch(action, {
          method: "POST",
          body: new FormData(form),
          headers: { "x-requested-with": "fetch" },
        });

        if (response.status === 428) {
          showCodePanel(form);

          return;
        }

        if (response.status >= 400) {
          const message = (await response.text()).trim();

          showErrors(form, [message === "" ? "The application was refused." : message]);

          return;
        }

        if (search.get("confirmation") === "none") {
          return;
        }

        if (meta.confirmationPath !== undefined) {
          globalThis.location.assign(meta.confirmationPath);

          return;
        }

        showConfirmation(form, meta.confirmationMessage);
      } catch {
        showErrors(form, ["The application request did not reach the server."]);
      }
    })();
  });
};

const run = () => {
  const form = document.querySelector<HTMLFormElement>("form#application-form");
  const meta = globalThis.fixtureMeta;

  if (form === null || meta === undefined) {
    return;
  }

  attachComboboxes(form, meta);
  attachSubmitBehaviour(form, meta);
};

run();

export { run as fixtureRuntime };
