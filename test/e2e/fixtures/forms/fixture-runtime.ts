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
  var fixtureMutation: string | undefined;
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

    const filename = form.querySelector<HTMLElement>(".filename");

    if (filename !== null) {
      filename.textContent = file.name;
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

const fieldValues = (form: HTMLFormElement) => {
  const values: Record<string, string> = {};

  for (const element of form.querySelectorAll<
    HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
  >("input, textarea, select")) {
    const key = element.name === "" ? element.id : element.name;

    if (key === "") {
      continue;
    }

    values[key] =
      element instanceof HTMLInputElement && element.type === "file"
        ? (element.files?.[0]?.name ?? "")
        : element.value;
  }

  return values;
};

const recordFieldValues = (form: HTMLFormElement) => {
  void fetch("/__fixture__/values", { method: "POST", body: JSON.stringify(fieldValues(form)) });
};

const attachSubmitBehaviour = (form: HTMLFormElement, meta: FixtureMeta) => {
  attachResumeEcho(form);

  const search = new URLSearchParams(globalThis.location.search);

  if (search.get("native") === "1") {
    prepareNativeSubmit(form);

    return;
  }

  const button = form.querySelector<HTMLButtonElement>("#btn-submit");

  if (button !== null) {
    button.addEventListener("click", () => {
      form.requestSubmit();
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();

    recordFieldValues(form);

    const declared = /"?submitPath"?\s*:\s*"(?<path>[^"]+)"/u.exec(
      document.documentElement.innerHTML,
    )?.groups?.path;

    const submitPath =
      declared === undefined
        ? `${form.getAttribute("action")}/application${globalThis.location.search}`
        : new URL(declared, globalThis.location.href).pathname;

    const jobApplication = fieldValues(form);

    void (async () => {
      try {
        const response = await fetch(submitPath, {
          method: "POST",
          body: JSON.stringify({ job_application: jobApplication }),
          headers: { "content-type": "application/json", "x-requested-with": "fetch" },
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

        await fetch("/__fixture__/confirmation-shown", { method: "POST" });

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

const ADDED_FIELDS = new Map([
  [
    "consent",
    `<div class="field-wrapper"><input id="consent" type="checkbox" aria-required="true" /><label for="consent">I acknowledge the privacy notice</label></div>`,
  ],
  [
    "one-off",
    `<div class="field-wrapper"><label for="question_added_one_off">Describe a project you are proud of</label><textarea id="question_added_one_off" aria-required="true"></textarea></div>`,
  ],
  [
    "work-auth",
    `<div class="field-wrapper"><label for="question_added_work_auth">Are you legally authorized to work in Canada?</label><input id="question_added_work_auth" type="text" aria-required="true" /></div>`,
  ],
]);

const mutateForm = (form: HTMLFormElement, meta: FixtureMeta) => {
  const search = new URLSearchParams(globalThis.location.search);
  const mutation = globalThis.fixtureMutation ?? search.get("mutation") ?? "";

  const added = ADDED_FIELDS.get(mutation) ?? ADDED_FIELDS.get(search.get("add-field") ?? "");

  if (added !== undefined) {
    form.insertAdjacentHTML("beforeend", added);
  }

  const removed =
    mutation === "field-removed" ? "question_32895467003" : search.get("remove-field");

  if (removed !== null && removed !== "") {
    form.querySelector<HTMLElement>(`#${removed}`)?.closest(".field-wrapper")?.remove();
  }

  if (mutation === "option-changed" || search.get("change-option") === "country") {
    meta.options.country = [
      { label: "United Kingdom", value: "United Kingdom" },
      { label: "United States", value: "United States" },
    ];
  }
};

const run = () => {
  const form = document.querySelector<HTMLFormElement>("form#application-form");
  const meta = globalThis.fixtureMeta;

  if (form === null || meta === undefined) {
    return;
  }

  mutateForm(form, meta);
  attachComboboxes(form, meta);
  attachSubmitBehaviour(form, meta);
};

run();

export { run as fixtureRuntime };
