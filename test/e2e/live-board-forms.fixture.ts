import { BATCH2_PATHS } from "./batch2-ats.fixture.ts";

/**
 * The 2026 BambooHR careers page: the job description first, the application
 * form behind "Apply for This Job", a Fabric form root whose Submit lives in
 * the footer, two file uploads, and select widgets whose options are only in a
 * popup. Saved from the live vicpark/jrec/eliteprivateschool pages the #710
 * rerun failed on.
 *
 * @param options Extra required question, when the caller tests the guard.
 * @returns The page HTML.
 */
export function bambooHrFabricPage(options: { extraRequired?: boolean } = {}) {
  const extra =
    options.extraRequired === true
      ? `<label for="extra">Current employer<span aria-hidden="true">*</span></label>
  <input id="extra" name="extra_answer" required>`
      : "";

  return `<!doctype html>
<html lang="en"><head><title>Front Desk Coordinator - BambooHR</title></head><body>
<button type="button" id="apply">Apply for This Job</button>
<section id="application" hidden>
  <form id="job-application-form" method="post" action="${BATCH2_PATHS.bamboohr.action}" enctype="multipart/form-data">
    <label for="firstName">First Name <span aria-hidden="true">*</span></label>
    <input id="firstName" name="firstName" required>
    <label for="lastName">Last Name <span aria-hidden="true">*</span></label>
    <input id="lastName" name="lastName" required>
    <label for="email">Email <span aria-hidden="true">*</span></label>
    <input id="email" name="email" type="email" required>
    <label for="phone">Phone <span aria-hidden="true">*</span></label>
    <input id="phone" name="phone" type="tel" required>

    <label for="street">Address <span aria-hidden="true">*</span></label>
    <input id="street" name="streetAddress.value" required>
    <label for="city">City <span aria-hidden="true">*</span></label>
    <input id="city" name="city.value" required>

    <div class="fab-Select">
      <label for="state">Province <span aria-hidden="true">*</span></label>
      <button type="button" class="fab-SelectToggle" aria-haspopup="listbox" aria-controls="state-menu" aria-expanded="false" aria-label="Province –Select–">
        <div class="fab-SelectToggle__placeholder">–Select–</div>
      </button>
      <select id="state" name="state.value" aria-hidden="true" required>
        <option value=""></option>
      </select>
      <div id="state-menu" role="listbox" hidden>
        <div role="option" data-value="ON">Ontario</div>
        <div role="option" data-value="QC">Quebec</div>
      </div>
    </div>

    <label for="zip">Postal Code <span aria-hidden="true">*</span></label>
    <input id="zip" name="zip.value" required>

    <div class="fab-Select">
      <label for="country">Country <span aria-hidden="true">*</span></label>
      <button type="button" class="fab-SelectToggle" aria-haspopup="listbox" aria-controls="country-menu" aria-expanded="false" aria-label="Country Canada">
        <div class="fab-SelectToggle__content">Canada</div>
      </button>
      <select id="country" name="countryId.value" aria-hidden="true" required>
        <option value="Canada" selected>Canada</option>
      </select>
      <div id="country-menu" role="listbox" hidden>
        <div role="option" data-value="Canada">Canada</div>
        <div role="option" data-value="United States">United States</div>
      </div>
    </div>

    <p>Cover Letter</p>
    <input type="file" aria-label="file-input">
    <p>Resume<span aria-hidden="true">*</span></p>
    <input type="file" aria-label="file-input" required data-resume>
    <input type="hidden" name="resumeFileId">

    <label for="date">Date Available</label>
    <input id="date" placeholder="dd/mm/yyyy" type="text" data-date>
    <input type="hidden" name="dateAvailable">
    <label for="pay">Desired Pay <span aria-hidden="true">*</span></label>
    <input id="pay" name="desiredPay" required>
    ${extra}
  </form>
  <button type="submit" form="job-application-form">Submit Application</button>
</section>
<script>
  const application = document.querySelector("#application");
  document.querySelector("#apply").addEventListener("click", () => {
    application.hidden = false;
  });

  for (const fab of document.querySelectorAll(".fab-Select")) {
    const toggle = fab.querySelector(".fab-SelectToggle");
    const menu = fab.querySelector("[role='listbox']");
    const select = fab.querySelector("select");

    toggle.addEventListener("click", () => {
      menu.hidden = !menu.hidden;
      toggle.setAttribute("aria-expanded", String(!menu.hidden));
    });

    for (const option of menu.querySelectorAll("[role='option']")) {
      option.addEventListener("click", () => {
        const text = option.textContent.trim();
        select.replaceChildren(new Option(text, option.dataset.value ?? text, true, true));
        toggle.replaceChildren();
        const content = document.createElement("div");
        content.className = "fab-SelectToggle__content";
        content.textContent = text;
        toggle.append(content);
        toggle.setAttribute("aria-label", text);
        menu.hidden = true;
        toggle.setAttribute("aria-expanded", "false");
      });
    }
  }

  document.querySelector("[data-resume]").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    document.querySelector("input[name='resumeFileId']").value = file?.name ?? "";
  });

  document.querySelector("[data-date]").addEventListener("change", (event) => {
    document.querySelector("input[name='dateAvailable']").value = event.target.value;
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      for (const menu of document.querySelectorAll(".fab-Select [role='listbox']")) {
        menu.hidden = true;
      }
    }
  });

  const form = document.querySelector("#job-application-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch(form.action, { body: new FormData(form), method: "POST" });
    const text = await response.text();
    document.body.innerHTML = response.ok ? text : "<h2>Something went wrong</h2>";
  });
</script>
</body></html>`;
}

/**
 * The 2026 Zoho Recruit careers page: a cookie notice, the webform behind
 * "I'm interested", a nameless form root selected by its `rec-form_` inputs,
 * a custom picklist, and a phone network that only commits after its country
 * picker has been chosen. Saved from the live icschools page the #710 rerun
 * stopped on with `identity_mismatch:board_token`.
 *
 * @param options Extra required question, when the caller tests the guard.
 * @returns The page HTML.
 */
export function zohoRecruitWebformPage(options: { extraRequired?: boolean } = {}) {
  const extra =
    options.extraRequired === true
      ? `<div class="crc-form-row"><label>Current employer<span class="crc-form-mandatory">*</span></label>
  <input name="extra_answer" required></div>`
      : "";

  return `<!doctype html>
<html lang="en"><head><title>Art Teacher - Zoho Recruit</title></head><body>
<div id="cookie"><button type="button" id="accept">Accept all</button></div>
<button type="button" id="interested">I'm interested</button>
<section id="webform" hidden>
  <form method="post" action="${BATCH2_PATHS.zoho_recruit.action}">
    <div class="crc-form-row">
      <label>Last Name <span class="crc-form-mandatory">*</span></label>
      <crux-text-component name="rec-form_last">
        <lyte-input><input type="text" name="rec-form_last" required></lyte-input>
      </crux-text-component>
    </div>
    <div class="crc-form-row">
      <label>Email</label>
      <crux-text-component name="rec-form_email">
        <lyte-input><input type="text" name="rec-form_email"></lyte-input>
      </crux-text-component>
    </div>
    <div class="crc-form-row">
      <label>Gender <span class="crc-form-mandatory">*</span></label>
      <crux-picklist-component id="rec-form_gender">
        <div role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="Gender">-None-</div>
        <lyte-drop-body id="Gender" role="listbox" hidden>
          <lyte-drop-item role="option" data-value="Female" aria-selected="false">Female</lyte-drop-item>
          <lyte-drop-item role="option" data-value="Male" aria-selected="false">Male</lyte-drop-item>
        </lyte-drop-body>
      </crux-picklist-component>
      <input type="hidden" name="gender_posted">
    </div>
    <div class="crc-form-row">
      <label>Mobile</label>
      <div role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-controls="phone-countries">Canada +1</div>
      <lyte-input><input type="text" id="inputId" name="rec-form_phone"></lyte-input>
      <lyte-drop-body id="phone-countries" role="listbox" hidden>
        <lyte-drop-item role="option" data-value="CA" aria-selected="true">Canada +1</lyte-drop-item>
        <lyte-drop-item role="option" data-value="US" aria-selected="false">United States +1</lyte-drop-item>
      </lyte-drop-body>
    </div>
    <div class="crc-form-row">
      <label>Resume</label>
      <input type="file" name="rec-form_resume_file">
    </div>
    ${extra}
    <button type="submit">Submit</button>
  </form>
</section>
<script>
  document.querySelector("#accept").addEventListener("click", () => {
    document.querySelector("#cookie").hidden = true;
  });
  document.querySelector("#interested").addEventListener("click", () => {
    document.querySelector("#webform").hidden = false;
  });

  const picklist = document.querySelector("crux-picklist-component");
  const picklistToggle = picklist.querySelector("[role='combobox']");
  const picklistMenu = picklist.querySelector("[role='listbox']");
  const picklistValue = document.querySelector("input[name='gender_posted']");

  picklistToggle.addEventListener("click", () => {
    picklistMenu.hidden = !picklistMenu.hidden;
    picklistToggle.setAttribute("aria-expanded", String(!picklistMenu.hidden));
  });
  for (const option of picklistMenu.querySelectorAll("[role='option']")) {
    option.addEventListener("click", () => {
      picklistToggle.textContent = option.textContent.trim();
      picklistValue.value = option.textContent.trim();
      picklistMenu.hidden = true;
      picklistToggle.setAttribute("aria-expanded", "false");
    });
  }

  const phoneToggle = document.querySelector(".crc-form-row [role='combobox'][aria-controls='phone-countries']");
  const phoneMenu = document.querySelector("#phone-countries");
  phoneToggle.addEventListener("click", () => {
    phoneMenu.hidden = !phoneMenu.hidden;
    phoneToggle.setAttribute("aria-expanded", String(!phoneMenu.hidden));
  });
  for (const option of phoneMenu.querySelectorAll("[role='option']")) {
    option.addEventListener("click", () => {
      phoneToggle.textContent = option.textContent.trim();
      phoneMenu.hidden = true;
      phoneToggle.setAttribute("aria-expanded", "false");
    });
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      picklistMenu.hidden = true;
      phoneMenu.hidden = true;
    }
  });

  const form = document.querySelector("form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const response = await fetch(form.action, { body: new FormData(form), method: "POST" });
    const text = await response.text();
    document.body.innerHTML = response.ok ? text : "<h2>Something went wrong</h2>";
  });
</script>
</body></html>`;
}
