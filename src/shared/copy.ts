export const copy = {
  app: {
    name: "Overture",
    description: "A job-search agent that applies to roles for you, and shows its work.",
    rootMissing: "The application root element is missing from the document.",
  },
  nav: {
    label: "Destinations",
    home: "Home",
    board: "Board",
    review: "Review",
    inbox: "Inbox",
    profile: "Profile",
  },
  home: {
    title: "Home",
    eyebrow: "Your search",
    applicationsLeft: "Applications left",
    applicationsLeftValue: "0",
    sentToday: "Sent today",
    sentTodayValue: "0",
    nextSend: "Next send",
    nextSendValue: "None yet",
    ready: "Overture is ready",
    skeletonNote:
      "The walking skeleton is running. Every screen you see here is served by the real stack.",
    nothingYet: "Nothing sent yet",
  },
  notFound: {
    title: "Not found",
    body: "This page does not exist yet.",
  },
} as const;
