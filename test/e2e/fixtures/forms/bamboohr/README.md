# Recorded BambooHR, Zoho Recruit and Manatal form fixtures

Each folder holds the response the board's own app uses to build its application form, saved on
2026-11-27. Nothing here was submitted, and no personal data is included.

- `bamboohr/islqatar-101.detail.json` is `GET https://islqatar.bamboohr.com/careers/101/detail`
  (the posting is `https://islqatar.bamboohr.com/careers/101`). The careers page itself is an app
  shell; `result.formFields` carries the 15 standard fields, the address select options and the
  three custom questions.
- `zoho-recruit/icschools-769705000015883276.page.html` keeps the real posting `var meta` object
  from `https://icschools.zohorecruit.com/jobs/Careers/769705000015883276`; the rest of the 1.8 MB
  app shell is omitted because the reader only needs `webform_id` and `page_name` from that object.
  `icschools-769705000015883276.webform.json` is the form the page then requests:
  `GET https://icschools.zohorecruit.com/recruit/v2/public/Job_Openings/769705000015883276/apply/769705000000496659?pagename=Careers&source=CareerSite`.
- `manatal/flexstaf-W3994VR9.apply.html` keeps the real `selectedJobId` and `baseUrl` constants
  from `https://www.careers-page.com/flexstaf-it/job/W3994VR9/apply`; the rest of the page is a Vue
  template. `flexstaf-W3994VR9.application-form.json` is the form the page then requests:
  `GET https://www.careers-page.com/api/v1.0/jobs/4611702/application-form/`.

BambooHR and Zoho Recruit answers are read from the JSON bodies above; Manatal's answer is the
`application-form` array. The posting pages never contain the fields themselves.
