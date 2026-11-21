interface AshbyFixtureMeta {
  confirmationMessage: string;
}

declare global {
  var ashbyFixtureMeta: AshbyFixtureMeta | undefined;
}

const clean = (text: string | null | undefined) => (text ?? "").replaceAll(/\s+/gu, " ").trim();

const chosenLabel = (control: HTMLInputElement) => {
  if (control.id === "") {
    return control.value;
  }

  const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(control.id)}"]`);

  return clean(label?.textContent) || control.value;
};

const collectedValues = () => {
  const values: Record<string, string> = {};

  for (const field of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement
  >("input, select, textarea")) {
    if (field instanceof HTMLInputElement && field.type === "file") {
      continue;
    }

    if (field instanceof HTMLInputElement && field.type === "radio") {
      if (field.checked) {
        values[field.name] = chosenLabel(field);
      }

      continue;
    }

    if (field instanceof HTMLInputElement && field.type === "checkbox") {
      if (field.checked) {
        values[field.name] = chosenLabel(field);
      }

      continue;
    }

    if (field.value === "") {
      continue;
    }

    values[field.name === "" ? field.id : field.name] = field.value;
  }

  const locationLabel = document.querySelector<HTMLLabelElement>(
    'label[for="_systemfield_location"]',
  );

  const locationInput = locationLabel
    ?.closest("[class*='ashby-application-form-field-entry']")
    ?.querySelector<HTMLInputElement>("input");

  if (locationInput?.value !== undefined && locationInput.value !== "") {
    values["_systemfield_location"] = locationInput.value;
  }

  return values;
};

const showAlert = (message: string) => {
  const alert = document.createElement("div");

  alert.setAttribute("role", "alert");
  alert.className = "ashby-application-form-alert";
  alert.textContent = message;

  document.body.append(alert);
};

const showConfirmation = (meta: AshbyFixtureMeta) => {
  for (const container of document.querySelectorAll(".ashby-application-form-container")) {
    container.remove();
  }

  const confirmation = document.createElement("div");

  confirmation.id = "ashby-confirmation";
  confirmation.innerHTML = meta.confirmationMessage;
  document.body.append(confirmation);
};

const attachResumeEcho = () => {
  const input = document.querySelector<HTMLInputElement>("#_systemfield_resume");

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

const attachSubmit = (meta: AshbyFixtureMeta) => {
  const button = document.querySelector<HTMLButtonElement>(".ashby-application-form-submit-button");

  if (button === null) {
    return;
  }

  button.addEventListener("click", () => {
    void (async () => {
      const search = new URLSearchParams(globalThis.location.search);

      const flags = {
        blank: search.get("blank") === "1",
        flagged: search.get("flagged") === "1",
        reject: search.get("reject") === "1",
      };

      try {
        const response = await fetch(
          "/api/non-user-graphql?op=ApiSubmitSingleApplicationFormAction",
          {
            body: JSON.stringify({
              operationName: "ApiSubmitSingleApplicationFormAction",
              variables: { fields: collectedValues(), ...flags },
            }),
            headers: { "content-type": "application/json" },
            method: "POST",
          },
        );

        if (flags.reject || response.status >= 400) {
          showAlert("Please enter the required information.");

          return;
        }

        if (flags.flagged) {
          showAlert("Your submission was flagged as possible spam.");

          return;
        }

        if (flags.blank) {
          return;
        }

        showConfirmation(meta);
      } catch {
        showAlert("The application request did not reach the server.");
      }
    })();
  });
};

const run = () => {
  const meta = globalThis.ashbyFixtureMeta;

  if (meta === undefined) {
    return;
  }

  attachResumeEcho();
  attachSubmit(meta);
};

run();

export { run as ashbyFixtureRuntime };
